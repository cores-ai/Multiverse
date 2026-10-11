import { NextResponse } from 'next/server';
import { getRepositories, getAccounts, updateRepositoryDeployment, createLog } from '@/lib/models';
import { identifyAccountsForMigration } from '@/lib/balancer';
import { migrateRepoToNewAccount } from '@/lib/migration';

export async function GET() {
    try {
        const repos = await getRepositories();
        const accounts = await getAccounts();

        const pingResults = [];

        // 1. Health Ping on active repos with live URLs
        for (const repo of repos) {
            if (repo.liveUrl) {
                const startTime = Date.now();
                let status = 'DOWN';
                let latencyMs = 0;

                try {
                    const controller = new AbortController();
                    const timeoutId = setTimeout(() => controller.abort(), 4000);

                    const res = await fetch(repo.liveUrl, {
                        method: 'HEAD',
                        signal: controller.signal
                    }).catch(() => null);

                    clearTimeout(timeoutId);
                    latencyMs = Date.now() - startTime;

                    if (res && res.status < 500) {
                        status = 'ONLINE';
                    }
                } catch {
                    status = 'DOWN';
                    latencyMs = Date.now() - startTime;
                }

                await updateRepositoryDeployment(repo.repoId, {
                    lastHealthPing: { status, latencyMs, checkedAt: new Date() }
                });

                pingResults.push({ repoId: repo.repoId, status, latencyMs });
            }
        }

        // 2. Identify low credit accounts (<= $2.00)
        const migrationCandidates = identifyAccountsForMigration(accounts);
        const migrationLogs = [];

        for (const candidate of migrationCandidates) {
            const lowAccount = candidate.account;
            // Find an eligible target account with open slot (< 2 repos) and > $2 credit
            const eligibleTarget = accounts.find(
                a => a.accountId !== lowAccount.accountId && (a.activeProjectsCount || 0) < 2 && Number(a.remainingCredits) > 2.0
            );

            if (eligibleTarget) {
                const reposToMigrate = repos.filter(r => r.assignedAccountId === lowAccount.accountId);
                for (const r of reposToMigrate) {
                    try {
                        await migrateRepoToNewAccount(r, eligibleTarget);
                        migrationLogs.push({ repo: r.repoName, to: eligibleTarget.accountId, status: 'MIGRATED' });
                    } catch (migErr) {
                        migrationLogs.push({ repo: r.repoName, error: migErr.message });
                    }
                }
            } else {
                await createLog({
                    type: 'MIGRATION_PENDING_JIT',
                    message: `Account ${lowAccount.accountId} is <= $2.00 but no target account has free slots. JIT generation needed.`,
                    metadata: { accountId: lowAccount.accountId }
                });
            }
        }

        return NextResponse.json({
            success: true,
            timestamp: new Date(),
            pings: pingResults,
            migrations: migrationLogs
        });
    } catch (e) {
        return NextResponse.json({ success: false, error: e.message }, { status: 500 });
    }
}
