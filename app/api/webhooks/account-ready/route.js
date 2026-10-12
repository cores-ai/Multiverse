import { NextResponse } from 'next/server';
import { createAccount, createLog, getRepositories } from '@/lib/models';
import { deployRepositoryToRailway } from '@/lib/railway';
import { queryD1, saveD1RailwayAccount } from '@/lib/d1';

export async function POST(request) {
    try {
        const body = await request.json();
        const { email, apiToken, secretKey } = body;

        // Security check
        const expectedSecret = process.env.WEBHOOK_SECRET || 'mega-server-jit-worker-secret-2026';
        if (secretKey !== expectedSecret) {
            return NextResponse.json({ success: false, error: 'Unauthorized webhook request' }, { status: 401 });
        }

        if (!apiToken || apiToken.includes('undefined') || apiToken.includes('fallback') || apiToken.startsWith('rly_tok_mv4') || apiToken.startsWith('rly_tok_live_test')) {
            return NextResponse.json({ success: false, error: 'Only genuine harvested Railway API tokens are allowed. Premature cards blocked.' }, { status: 400 });
        }

        // 1. Sanitize email
        let cleanEmail = email;
        if (cleanEmail && cleanEmail.includes('@')) {
            const [u, d] = cleanEmail.split('@');
            cleanEmail = `${(u || '').replace(/[_.]/g, '')}@${d || 'mailu.site'}`;
        }

        // 2. Register the newly harvested Railway account
        const newAccount = await createAccount({
            email: cleanEmail || `user${Date.now()}@mailu.site`,
            apiToken,
            initialCredits: 5.0,
            status: 'active'
        });

        // 3. Persist to Cloudflare D1 railway_accounts table
        try {
            await saveD1RailwayAccount({
                account_id: newAccount.accountId,
                email: newAccount.email,
                api_token: apiToken,
                status: 'ACTIVE',
                credits_remaining: 5.0,
                days_left: 30,
                repos_count: 0,
                max_capacity: 2
            });
        } catch (d1Err) {
            console.warn('[D1 Sync Warning in webhook]:', d1Err.message);
        }

        await createLog({
            type: 'JIT_ACCOUNT_HARVESTED',
            message: `Harvested fresh Railway account via Playwright worker: ${newAccount.email}`,
            metadata: { accountId: newAccount.accountId }
        }).catch(() => {});

        // 4. Auto-Deploy Pending / Target Repositories from D1
        let deployedRepoName = null;
        try {
            // Find repositories in D1 needing deployment (railway_project_id is NULL or not ACTIVE)
            const pendingRepos = await queryD1(
                "SELECT repo_name, account_id, railway_project_id, deployment_status FROM repo_deployments WHERE railway_project_id IS NULL OR deployment_status != 'ACTIVE' ORDER BY created_at ASC LIMIT 1;"
            ).catch(() => []);

            let targetRepo = null;
            if (pendingRepos && pendingRepos.length > 0) {
                targetRepo = pendingRepos[0].repo_name;
            } else {
                // If all are deployed, check if any repository exists
                const anyRepo = await queryD1("SELECT repo_name FROM repo_deployments ORDER BY created_at DESC LIMIT 1;").catch(() => []);
                if (anyRepo && anyRepo.length > 0) {
                    targetRepo = anyRepo[0].repo_name;
                }
            }

            if (targetRepo) {
                console.log(`🚀 [Webhook Auto-Deploy] Provisioning repo "${targetRepo}" using newly harvested token...`);
                const deployResult = await deployRepositoryToRailway({
                    apiToken,
                    repoName: targetRepo
                });

                // Link account_id to this deployment in D1
                await queryD1(
                    "UPDATE repo_deployments SET account_id = ? WHERE repo_name = ?;",
                    [newAccount.accountId, targetRepo]
                ).catch(() => {});

                await queryD1(
                    "UPDATE railway_accounts SET repos_count = repos_count + 1 WHERE account_id = ?;",
                    [newAccount.accountId]
                ).catch(() => {});

                deployedRepoName = targetRepo;

                await createLog({
                    type: 'JIT_AUTO_DEPLOYED',
                    message: `Successfully auto-deployed ${targetRepo} onto Railway (${newAccount.accountId}) with ${deployResult.injectedEnvCount} envs`,
                    metadata: { repoName: targetRepo, accountId: newAccount.accountId, liveUrl: deployResult.liveUrl }
                }).catch(() => {});
            }
        } catch (deployErr) {
            console.error('❌ [Railway Auto-Deploy Notice]:', deployErr.message);
        }

        return NextResponse.json({
            success: true,
            account: newAccount.accountId,
            email: newAccount.email,
            deployedRepo: deployedRepoName
        });
    } catch (e) {
        console.error('POST /api/webhooks/account-ready error:', e.message);
        return NextResponse.json({ success: false, error: e.message }, { status: 500 });
    }
}
