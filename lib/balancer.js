import { getActiveAccounts, getAccounts, getRepositories, updateRepositoryDeployment, createLog } from './models';
import { getDatabase } from './mongodb';

/**
 * Smart Capacity Balancer (JIT Provisioning)
 * Rule 1: Max 2 repos per Railway account.
 * Rule 2: Minimum $2.00 remaining credit required.
 * Rule 3: JIT Trigger - If all accounts are full (2/2) or no account available,
 *         flags that a new Railway account must be generated just-in-time.
 */
export async function allocateSlot(serviceType = 'HEAVY') {
    const activeAccounts = await getActiveAccounts();

    // 1. Filter accounts with open slots (< 2 repos) and sufficient credit (> $2)
    const eligibleAccounts = activeAccounts.filter(acc => {
        const slotsUsed = acc.activeProjectsCount || 0;
        const credits = Number(acc.remainingCredits) || 0;
        return slotsUsed < 2 && credits > 2.0;
    });

    if (eligibleAccounts.length > 0) {
        // Sort by least utilized slot first (e.g. 0 slots used before 1 slot used)
        eligibleAccounts.sort((a, b) => (a.activeProjectsCount || 0) - (b.activeProjectsCount || 0));
        const selected = eligibleAccounts[0];

        await createLog({
            type: 'SLOT_ALLOCATED',
            message: `Allocated slot on existing account ${selected.accountId} (${selected.activeProjectsCount + 1}/2)`,
            metadata: { accountId: selected.accountId, serviceType }
        });

        return {
            needsNewAccount: false,
            account: selected,
            slotNumber: (selected.activeProjectsCount || 0) + 1
        };
    }

    // 2. All accounts are at full capacity (2/2) or below $2 credit
    await createLog({
        type: 'JIT_TRIGGER',
        message: 'No available slots in active fleet. Triggering Just-In-Time account generation.',
        metadata: { totalActiveAccounts: activeAccounts.length, requestedType: serviceType }
    });

    return {
        needsNewAccount: true,
        account: null,
        reason: activeAccounts.length === 0 ? 'NO_ACCOUNTS_IN_FLEET' : 'FLEET_CAPACITY_FULL'
    };
}

/**
 * Automatically transfers repo load across Railway worker accounts.
 * When a new account is registered or when load is imbalanced (e.g. 2 repos on one node, 0 on another),
 * repos are redistributed to achieve uniform capacity across the fleet.
 */
export async function rebalanceFleetLoad() {
    try {
        const db = await getDatabase();
        const accounts = await getAccounts();
        const repos = await getRepositories();

        if (accounts.length <= 1 || repos.length === 0) {
            return { rebalanced: false, transferredCount: 0, message: 'Minimum 2 accounts needed to balance' };
        }

        // Eligible healthy accounts with > $2 credit
        const eligibleAccounts = accounts.filter(acc => 
            acc.status !== 'exhausted' && Number(acc.remainingCredits || 0) > 2.0
        );

        if (eligibleAccounts.length === 0) {
            return { rebalanced: false, transferredCount: 0, message: 'No eligible target accounts with > $2.00 credit' };
        }

        const events = [];

        // Build current mapping of repos per account
        const accountRepoMap = {};
        eligibleAccounts.forEach(a => {
            accountRepoMap[a.accountId] = [];
        });

        // Track unassigned repos or assigned repos
        const unassignedRepos = [];
        repos.forEach(r => {
            if (r.assignedAccountId && accountRepoMap[r.assignedAccountId]) {
                accountRepoMap[r.assignedAccountId].push(r);
            } else {
                unassignedRepos.push(r);
            }
        });

        // 1. Assign any unassigned repos to the least loaded accounts first
        for (const unassigned of unassignedRepos) {
            const sorted = Object.keys(accountRepoMap).sort((a, b) => accountRepoMap[a].length - accountRepoMap[b].length);
            const targetId = sorted[0];
            if (accountRepoMap[targetId].length < 2) {
                accountRepoMap[targetId].push(unassigned);
                const targetAcc = eligibleAccounts.find(a => a.accountId === targetId);
                await updateRepositoryDeployment(unassigned.repoId, {
                    assignedAccountId: targetId,
                    deploymentStatus: 'ACTIVE',
                    updatedAt: new Date()
                });
                await db.collection('accounts').updateOne(
                    { accountId: targetId },
                    { $set: { activeProjectsCount: accountRepoMap[targetId].length, lastSyncedAt: new Date() } }
                );
                await createLog({
                    type: 'LOAD_TRANSFERRED',
                    message: `Assigned unassigned repo '${unassigned.repoName}' to node ${targetAcc?.email || targetId}`,
                    metadata: { repoId: unassigned.repoId, targetAccountId: targetId }
                });
                events.push({ repo: unassigned.repoName, to: targetAcc?.email || targetId });
            }
        }

        // 2. Continuous Rebalancing: If maxLoaded account has >= 2 more repos than minLoaded, transfer 1 repo
        let iterations = 0;
        while (iterations < 10) {
            iterations++;
            const sortedIds = Object.keys(accountRepoMap).sort((a, b) => accountRepoMap[a].length - accountRepoMap[b].length);
            const leastId = sortedIds[0];
            const mostId = sortedIds[sortedIds.length - 1];

            const minCount = accountRepoMap[leastId].length;
            const maxCount = accountRepoMap[mostId].length;

            // Stop if difference is <= 1 or minCount is already at max capacity (2)
            if (maxCount - minCount <= 1 || minCount >= 2 || maxCount === 0) {
                break;
            }

            // Transfer 1 repo from mostId to leastId
            const repoToTransfer = accountRepoMap[mostId].pop();
            accountRepoMap[leastId].push(repoToTransfer);

            const sourceAcc = eligibleAccounts.find(a => a.accountId === mostId);
            const targetAcc = eligibleAccounts.find(a => a.accountId === leastId);

            await updateRepositoryDeployment(repoToTransfer.repoId, {
                assignedAccountId: targetAcc.accountId,
                updatedAt: new Date()
            });

            await db.collection('accounts').updateOne(
                { accountId: sourceAcc.accountId },
                { $set: { activeProjectsCount: accountRepoMap[mostId].length, lastSyncedAt: new Date() } }
            );

            await db.collection('accounts').updateOne(
                { accountId: targetAcc.accountId },
                { $set: { activeProjectsCount: accountRepoMap[leastId].length, lastSyncedAt: new Date() } }
            );

            await createLog({
                type: 'LOAD_TRANSFERRED',
                message: `Transferred repo '${repoToTransfer.repoName}' from ${sourceAcc.email} to ${targetAcc.email} (${targetAcc.accountId}) to balance fleet load.`,
                metadata: {
                    repoId: repoToTransfer.repoId,
                    fromAccount: sourceAcc.accountId,
                    toAccount: targetAcc.accountId
                }
            });

            events.push({
                repo: repoToTransfer.repoName,
                from: sourceAcc.email,
                to: targetAcc.email
            });
        }

        // Resync actual counts for all accounts
        for (const acc of eligibleAccounts) {
            const actualCount = (accountRepoMap[acc.accountId] || []).length;
            await db.collection('accounts').updateOne(
                { accountId: acc.accountId },
                { $set: { activeProjectsCount: actualCount, lastSyncedAt: new Date() } }
            );
        }

        return {
            rebalanced: events.length > 0,
            transferredCount: events.length,
            events
        };
    } catch (err) {
        console.error('Error during fleet load rebalance:', err);
        return { rebalanced: false, error: err.message };
    }
}

/**
 * Scans the account pool for low-credit accounts (<= $2.00) or expiring cycles.
 * Returns accounts that need proactive Blue-Green migration.
 */
export function identifyAccountsForMigration(accountsList) {
    const candidates = [];
    for (const acc of accountsList) {
        const credits = Number(acc.remainingCredits) || 0;
        if (credits <= 2.0 && acc.status !== 'migrating' && acc.status !== 'exhausted') {
            candidates.push({
                account: acc,
                reason: `Credit threshold reached ($${credits.toFixed(2)} <= $2.00)`
            });
        }
    }
    return candidates;
}

