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

        // Clear active harvester lock upon successful harvest
        global._activeHarvester = null;

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

            // Auto-deploy target repo (giveaway or pending) to this fresh Railway account
            let targetRepo = 'giveaway';
            const pending = await queryD1('SELECT repo_name FROM repo_deployments ORDER BY created_at ASC LIMIT 1;').catch(() => []);
            if (pending && pending[0]?.repo_name) {
                targetRepo = pending[0].repo_name;
            }

            console.log(`🚀 [Auto-Deploy] Launching automated Railway fleet deployment for: ${targetRepo}...`);
            const { deployRepositoryToRailway } = await import('@/lib/railway');
            const deployResult = await deployRepositoryToRailway({
                apiToken,
                repoName: targetRepo,
                githubOrg: 'Coras-Multiverse',
                accountId: newAccount.accountId
            });

            console.log(`✅ [Auto-Deploy] Deployment completed successfully! Live URL: ${deployResult.liveUrl}`);

            await createLog({
                type: 'AUTO_DEPLOY_COMPLETE',
                message: `Auto-deployed repo '${targetRepo}' on new account ${cleanEmail} with full ENV injection. Live: ${deployResult.liveUrl}`,
                metadata: { repo: targetRepo, projectId: deployResult.projectId, serviceId: deployResult.serviceId, liveUrl: deployResult.liveUrl }
            });
        } catch (d1Err) {
            console.warn('[D1 Sync / Auto-Deploy Warning in webhook]:', d1Err.message);
        }

        await createLog({
            type: 'JIT_ACCOUNT_HARVESTED',
            message: `Harvested fresh Railway account via Playwright worker: ${newAccount.email}`,
            metadata: { accountId: newAccount.accountId }
        });

        // 2. Check for any pending repos waiting for a JIT account
        const allRepos = await getRepositories();
        const waitingRepo = allRepos.find(r => r.deploymentStatus === 'WAITING_JIT_ACCOUNT');

        let deployedRepo = null;
        if (waitingRepo) {
            try {
                // Auto-deploy the waiting repo onto this fresh account
                const project = await createRailwayProject(newAccount.apiToken, waitingRepo.repoName);
                const service = await createRailwayService(newAccount.apiToken, project.projectId, waitingRepo.repoName, waitingRepo.repoName);

                // Fetch linked envs
                const { variables } = await getRepoEnvVariables(waitingRepo.repoId);
                await setRailwayVariables(
                    newAccount.apiToken,
                    project.projectId,
                    project.environmentId,
                    service.id,
                    variables
                );

                await triggerRailwayDeploy(newAccount.apiToken, service.id, project.environmentId);

                await updateRepositoryDeployment(waitingRepo.repoId, {
                    assignedAccountId: newAccount.accountId,
                    railwayProjectId: project.projectId,
                    railwayServiceId: service.id,
                    deploymentStatus: 'BUILDING',
                    liveUrl: `https://${service.name}-production.up.railway.app`
                });

                await updateAccountProjectsCount(newAccount.accountId, 1);
                deployedRepo = waitingRepo.repoId;

                await createLog({
                    type: 'JIT_AUTO_DEPLOYED',
                    message: `Auto-deployed waiting repo ${waitingRepo.repoName} onto fresh account ${newAccount.accountId}`,
                    metadata: { repoId: waitingRepo.repoId, accountId: newAccount.accountId }
                });
            } catch (deployErr) {
                console.error('Error deploying waiting repo:', deployErr.message);
            }
        }

        return NextResponse.json({
            success: true,
            account: newAccount.accountId,
            deployedWaitingRepo: deployedRepo
        });
    } catch (e) {
        console.error('POST /api/webhooks/account-ready error:', e.message);
        return NextResponse.json({ success: false, error: e.message }, { status: 500 });
    }
}
