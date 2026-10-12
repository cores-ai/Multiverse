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

        // 2. Scan D1 & fleet for low credit (<= $2.00) or expiring (<= 1 day) accounts
        const migrationLogs = [];
        try {
            const { getD1RailwayAccounts, queryD1 } = await import('@/lib/d1');
            const d1Accounts = await getD1RailwayAccounts().catch(() => []);
            const { executeAutonomousFailover } = await import('@/lib/migration');

            for (const acc of d1Accounts) {
                const credits = Number(acc.credits_remaining !== undefined ? acc.credits_remaining : 5.0);
                const daysLeft = Number(acc.days_left !== undefined ? acc.days_left : 30);

                if (credits <= 2.0 || daysLeft <= 1) {
                    console.log(`⚠️ [Watchdog Alert] Account ${acc.email} reached threshold: $${credits.toFixed(2)}, ${daysLeft}d left.`);
                    
                    // Find all repos deployed on this low-credit account
                    const boundRepos = await queryD1('SELECT repo_name FROM repo_deployments WHERE account_id = ?;', [acc.account_id]).catch(() => []);
                    
                    for (const repoRow of boundRepos) {
                        try {
                            const res = await executeAutonomousFailover({
                                repoName: repoRow.repo_name,
                                oldAccountId: acc.account_id,
                                oldEmail: acc.email
                            });
                            migrationLogs.push({ repo: repoRow.repo_name, status: 'MIGRATED', details: res });
                        } catch (migErr) {
                            migrationLogs.push({ repo: repoRow.repo_name, error: migErr.message });
                        }
                    }
                }
            }
        } catch (d1ScanErr) {
            console.warn('[Watchdog D1 scan notice]:', d1ScanErr.message);
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
