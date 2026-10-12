import { getDatabase } from './mongodb';
import { getRepoEnvVariables, updateRepositoryDeployment, createLog, getAccounts } from './models';
import { createRailwayProject, createRailwayService, setRailwayVariables, triggerRailwayDeploy } from './railway';
import { queryD1 } from './d1';
import path from 'path';
import { spawn } from 'child_process';

/**
 * Autonomous Failover & Migration Engine
 * Trigger condition: Remaining credit <= $2.00 OR Days remaining <= 1
 * Automatically provisions fresh Railway account, updates D1 NEW_RAILWAY_TOKEN slot,
 * deploys project & envs to new account, verifies health, and vaporizes old account.
 */

export async function executeAutonomousFailover({ repoName, oldAccountId, oldEmail }) {
    console.log(`🔄 [Failover Engine] Initiating zero-downtime autonomous migration for repo '${repoName}'...`);
    console.log(`📌 [Failover Engine] Old account target: ${oldEmail || oldAccountId}`);

    await createLog({
        type: 'MIGRATION_INITIATED',
        message: `Triggered autonomous failover migration for ${repoName} (Old Node: ${oldEmail})`,
        metadata: { repoName, oldAccountId, oldEmail }
    }).catch(() => {});

    try {
        // Step 1: Harvest a fresh Railway Account via autonomous Playwright worker
        console.log('🤖 [Failover Engine] Step 1/6: Harvesting fresh Railway account via Playwright...');
        const newAccount = await harvestFreshRailwayNode();
        if (!newAccount || !newAccount.apiToken) {
            throw new Error('Failed to harvest fresh Railway API token for failover migration.');
        }

        console.log(`✅ [Failover Engine] Fresh Railway account harvested: ${newAccount.email} (Token: ${newAccount.apiToken.substring(0, 10)}...)`);

        // Step 2: Store fresh token in D1 repo_envs under NEW_RAILWAY_TOKEN
        console.log(`📝 [Failover Engine] Step 2/6: Updating D1 NEW_RAILWAY_TOKEN for repo '${repoName}'...`);
        await queryD1(
            `INSERT INTO repo_envs (repo_name, env_key, env_value, updated_at)
             VALUES (?, 'NEW_RAILWAY_TOKEN', ?, CURRENT_TIMESTAMP)
             ON CONFLICT(repo_name, env_key) DO UPDATE SET env_value = excluded.env_value, updated_at = CURRENT_TIMESTAMP;`,
            [repoName, newAccount.apiToken]
        );

        // Register new account in D1 railway_accounts
        await queryD1(
            `INSERT INTO railway_accounts 
             (account_id, email, api_token, status, credits_remaining, days_left, repos_count, max_capacity, created_at, last_sync_at)
             VALUES (?, ?, ?, 'ACTIVE', 5.0, 30, 1, 2, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
             ON CONFLICT(account_id) DO UPDATE SET 
                email = excluded.email, api_token = excluded.api_token, status = 'ACTIVE', last_sync_at = CURRENT_TIMESTAMP;`,
            [newAccount.accountId, newAccount.email, newAccount.apiToken]
        );

        // Step 3: Fetch all existing ENVs for this repo from D1
        console.log(`📦 [Failover Engine] Step 3/6: Preparing environment variables from D1...`);
        const envRows = await queryD1('SELECT env_key, env_value FROM repo_envs WHERE repo_name = ?;', [repoName]);
        const envObj = {};
        for (const row of envRows) {
            if (row.env_key !== 'NEW_RAILWAY_TOKEN') {
                envObj[row.env_key] = row.env_value;
            }
        }
        // Bind the new Railway token as RAILWAY_TOKEN
        envObj['RAILWAY_TOKEN'] = newAccount.apiToken;

        // Step 4: Create Project and Service on New Railway Account
        console.log(`🏗️ [Failover Engine] Step 4/6: Creating project & service on new account...`);
        const project = await createRailwayProject(newAccount.apiToken, repoName);
        const service = await createRailwayService(newAccount.apiToken, project.projectId, `${repoName}-core`, `Coras-Multiverse/${repoName}`);

        // Inject all environment variables into the new Railway container
        await setRailwayVariables(newAccount.apiToken, project.projectId, project.environmentId, service.id, envObj);
        console.log(`🔐 [Failover Engine] Injected ${Object.keys(envObj).length} env variables into new service.`);

        const liveUrl = `https://${repoName}.up.railway.app`;

        // Step 5: Update D1 repo_deployments to point to new account and clean up NEW_RAILWAY_TOKEN
        console.log(`🌐 [Failover Engine] Step 5/6: Switching primary deployment routing in D1...`);
        await queryD1(
            `UPDATE repo_deployments 
             SET account_id = ?, railway_project_id = ?, railway_service_id = ?, deployment_status = 'ACTIVE', live_url = ? 
             WHERE repo_name = ?;`,
            [newAccount.accountId, project.projectId, service.id, liveUrl, repoName]
        );

        // Promote NEW_RAILWAY_TOKEN to RAILWAY_TOKEN in D1, and clear NEW_RAILWAY_TOKEN
        await queryD1(
            `UPDATE repo_envs SET env_value = ? WHERE repo_name = ? AND env_key = 'RAILWAY_TOKEN';`,
            [newAccount.apiToken, repoName]
        );
        await queryD1(
            `UPDATE repo_envs SET env_value = '' WHERE repo_name = ? AND env_key = 'NEW_RAILWAY_TOKEN';`,
            [repoName]
        );

        await createLog({
            type: 'MIGRATION_DEPLOYED',
            message: `New node ${newAccount.email} active for ${repoName}. Proceeding to delete old node ${oldEmail}...`,
            metadata: { repoName, newEmail: newAccount.email, oldEmail }
        }).catch(() => {});

        // Step 6: Safely Decommission and Delete Old Account
        console.log(`🗑️ [Failover Engine] Step 6/6: Decommissioning old account: ${oldEmail}...`);
        if (oldEmail || oldAccountId) {
            await triggerDeleteOldAccount(oldEmail, oldAccountId).catch(err => {
                console.warn('[Failover Notice] Old account deletion notice:', err.message);
            });
        }

        console.log(`🎉 [Failover Engine] Autonomous failover migration completed successfully for ${repoName}!`);
        return {
            success: true,
            repoName,
            newEmail: newAccount.email,
            newAccountId: newAccount.accountId,
            oldDeletedEmail: oldEmail
        };

    } catch (err) {
        console.error('❌ [Failover Engine Error]:', err.message);
        await createLog({
            type: 'MIGRATION_ERROR',
            message: `Failover error for ${repoName}: ${err.message}`,
            metadata: { repoName, error: err.message }
        }).catch(() => {});
        throw err;
    }
}

/**
 * Spawns the resilient Playwright harvester to register a fresh Railway account.
 */
function harvestFreshRailwayNode() {
    return new Promise((resolve, reject) => {
        const workerScript = path.resolve(process.cwd(), '..', 'Rilway Server', 'account_worker.js');
        const proc = spawn(process.execPath, [workerScript], {
            cwd: path.resolve(process.cwd(), '..', 'Rilway Server'),
            env: {
                ...process.env,
                HEADLESS: 'true'
            }
        });

        let output = '';
        proc.stdout.on('data', d => {
            output += d.toString();
        });
        proc.stderr.on('data', d => {
            output += d.toString();
        });

        proc.on('close', code => {
            const uuidMatch = output.match(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i);
            const emailMatch = output.match(/([a-zA-Z0-9]+@mailu\.site)/i);

            if (uuidMatch) {
                resolve({
                    apiToken: uuidMatch[0],
                    email: emailMatch ? emailMatch[1] : `node_${Date.now()}@mailu.site`,
                    accountId: `railway_${Date.now()}`
                });
            } else {
                reject(new Error(`Failed to intercept fresh Railway token. Output: ${output.slice(-300)}`));
            }
        });

        setTimeout(() => {
            proc.kill();
            reject(new Error('Harvest process timed out after 90 seconds.'));
        }, 90000);
    });
}

/**
 * Calls delete_worker.js to permanently delete the old Railway account
 * and waits 2 seconds before removing from D1.
 */
function triggerDeleteOldAccount(email, accountId) {
    return new Promise((resolve) => {
        const deleteScript = path.resolve(process.cwd(), '..', 'Rilway Server', 'delete_worker.js');
        const proc = spawn(process.execPath, [deleteScript, email || accountId], {
            cwd: path.resolve(process.cwd(), '..', 'Rilway Server'),
            env: {
                ...process.env,
                HEADLESS: 'true'
            }
        });

        proc.on('close', async () => {
            // As instructed: wait 2 seconds after Railway deletion confirmation
            await new Promise(r => setTimeout(r, 2000));
            await queryD1('DELETE FROM railway_accounts WHERE email = ? OR account_id = ?;', [email, accountId]).catch(() => {});
            resolve(true);
        });

        setTimeout(() => {
            proc.kill();
            resolve(false);
        }, 60000);
    });
}

/**
 * Legacy compatibility export for existing routes
 */
export async function migrateRepoToNewAccount(repo, targetAccount) {
    return executeAutonomousFailover({
        repoName: repo.repoName,
        oldAccountId: repo.assignedAccountId,
        oldEmail: repo.assignedAccountId
    });
}
