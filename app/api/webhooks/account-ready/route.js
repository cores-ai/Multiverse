import { NextResponse } from 'next/server';
import { createAccount, createLog, getRepositories, getRepoEnvVariables, updateRepositoryDeployment, updateAccountProjectsCount } from '@/lib/models';
import { createRailwayProject, createRailwayService, setRailwayVariables, triggerRailwayDeploy } from '@/lib/railway';

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

        // 1. Sanitize email to enforce strictly letters and numbers (no _ or .)
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

        // 3. Sync to Cloudflare D1 railway_accounts table
        try {
            const { saveD1RailwayAccount, queryD1 } = await import('@/lib/d1');
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

            // Link any unassigned repo deployment in D1 to this account
            const unassigned = await queryD1('SELECT repo_name FROM repo_deployments WHERE account_id IS NULL LIMIT 1;').catch(() => []);
            if (unassigned && unassigned.length > 0) {
                const targetRepo = unassigned[0].repo_name;
                await queryD1('UPDATE repo_deployments SET account_id = ? WHERE repo_name = ?;', [newAccount.accountId, targetRepo]).catch(() => {});
                await queryD1('UPDATE railway_accounts SET repos_count = 1 WHERE account_id = ?;', [newAccount.accountId]).catch(() => {});
            }
        } catch (d1Err) {
            console.warn('[D1 Sync Warning in webhook]:', d1Err.message);
        }

        await createLog({
            type: 'JIT_ACCOUNT_HARVESTED',
            message: `Harvested fresh Railway account via Playwright worker: ${newAccount.email}`,
            metadata: { accountId: newAccount.accountId }
        });

        // 3. Auto-Deploy Target Repo & Inject Environments via Railway GraphQL API
        let deployedRepoName = null;
        try {
            const { queryD1 } = await import('@/lib/d1');
            
            // 3a. Find target unassigned repository from D1 or MongoDB
            let targetRepoName = null;
            let targetRepoId = null;

            const d1Repos = await queryD1('SELECT repo_name, account_id FROM repo_deployments ORDER BY created_at DESC LIMIT 5;').catch(() => []);
            const unassignedD1 = d1Repos.find(r => !r.account_id);
            if (unassignedD1) {
                targetRepoName = unassignedD1.repo_name;
            } else if (d1Repos.length > 0) {
                targetRepoName = d1Repos[0].repo_name;
            }

            const allRepos = await getRepositories().catch(() => []);
            const mongoRepo = allRepos.find(r => r.deploymentStatus === 'WAITING_JIT_ACCOUNT' || !r.assignedAccountId || r.repoName === targetRepoName);
            if (mongoRepo) {
                targetRepoName = mongoRepo.repoName || targetRepoName;
                targetRepoId = mongoRepo.repoId;
            }

            if (!targetRepoName) {
                targetRepoName = 'giveaway';
            }

            // 3b. Collect all environment variables for this repo from D1 repo_envs & Mongo
            const envMap = {};
            const d1Envs = await queryD1('SELECT env_key, env_value FROM repo_envs WHERE repo_name = ?;', [targetRepoName]).catch(() => []);
            if (Array.isArray(d1Envs)) {
                d1Envs.forEach(e => {
                    if (e.env_key) envMap[e.env_key] = e.env_value;
                });
            }

            if (targetRepoId) {
                const { variables: mongoEnvs } = await getRepoEnvVariables(targetRepoId).catch(() => ({ variables: {} }));
                if (mongoEnvs) {
                    Object.assign(envMap, mongoEnvs);
                }
            }

            console.log(`🚀 [Railway Auto-Deploy] Deploying repo ${targetRepoName} with ${Object.keys(envMap).length} env variables...`);

            // 3c. Create Railway Project & Service with verified token
            const cleanProjectName = (targetRepoName || 'cluster-fleet').replace(/[^a-zA-Z0-9_-]/g, '-').toLowerCase();
            const project = await createRailwayProject(newAccount.apiToken, cleanProjectName);
            const service = await createRailwayService(newAccount.apiToken, project.projectId, cleanProjectName, targetRepoName);

            // 3d. Inject Environment Variables into Railway Service
            if (Object.keys(envMap).length > 0) {
                await setRailwayVariables(
                    newAccount.apiToken,
                    project.projectId,
                    project.environmentId,
                    service.id,
                    envMap
                );
            }

            // 3e. Trigger Railway Build & Deploy
            await triggerRailwayDeploy(newAccount.apiToken, service.id, project.environmentId).catch(() => {});

            const liveUrl = `https://${cleanProjectName}.up.railway.app`;

            // 3f. Link in Cloudflare D1
            await queryD1(
                `UPDATE repo_deployments 
                 SET account_id = ?, railway_project_id = ?, railway_service_id = ?, deployment_status = 'ACTIVE', live_url = ? 
                 WHERE repo_name = ?;`,
                [newAccount.accountId, project.projectId, service.id, liveUrl, targetRepoName]
            ).catch(() => {});

            await queryD1(
                `UPDATE railway_accounts SET repos_count = repos_count + 1 WHERE account_id = ?;`,
                [newAccount.accountId]
            ).catch(() => {});

            if (targetRepoId) {
                await updateRepositoryDeployment(targetRepoId, {
                    assignedAccountId: newAccount.accountId,
                    railwayProjectId: project.projectId,
                    railwayServiceId: service.id,
                    deploymentStatus: 'ACTIVE',
                    liveUrl
                }).catch(() => {});
                await updateAccountProjectsCount(newAccount.accountId, 1).catch(() => {});
            }

            deployedRepoName = targetRepoName;

            await createLog({
                type: 'JIT_AUTO_DEPLOYED',
                message: `Successfully deployed repo ${targetRepoName} with ${Object.keys(envMap).length} envs onto Railway (${newAccount.accountId})`,
                metadata: { repoName: targetRepoName, accountId: newAccount.accountId, liveUrl }
            }).catch(() => {});

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
