import { NextResponse } from 'next/server';
import { saveD1RailwayAccount, saveD1RepoDeployment, getD1RepoEnvs, queryD1, getRemoteConfig } from '@/lib/d1';
import { createAccount, createLog, getRepositories, getRepoEnvVariables, updateRepositoryDeployment, updateAccountProjectsCount } from '@/lib/models';
import { createRailwayProject, createRailwayService, setRailwayVariables, triggerRailwayDeploy } from '@/lib/railway';

export async function POST(request) {
    try {
        const body = await request.json();
        const { email, apiToken, secretKey } = body;

        // Security check
        const d1Secret = await getRemoteConfig('WEBHOOK_SECRET');
        const expectedSecret = d1Secret || process.env.WEBHOOK_SECRET || 'mega-server-jit-worker-secret-2026';
        if (secretKey !== expectedSecret) {
            return NextResponse.json({ success: false, error: 'Unauthorized webhook request' }, { status: 401 });
        }

        if (!apiToken) {
            return NextResponse.json({ success: false, error: 'apiToken is required' }, { status: 400 });
        }

        // 1. Sanitize email to enforce strictly letters and numbers (no _ or .)
        let cleanEmail = email;
        if (cleanEmail && cleanEmail.includes('@')) {
            const [u, d] = cleanEmail.split('@');
            cleanEmail = `${(u || '').replace(/[_.]/g, '')}@${d || 'mailu.site'}`;
        }

        const accountId = `rly_${Date.now().toString(36)}_${Math.random().toString(36).substring(2, 6)}`;

        // 2. Persist directly into Cloudflare D1
        await saveD1RailwayAccount({
            account_id: accountId,
            email: cleanEmail,
            api_token: apiToken,
            status: 'ACTIVE',
            credits_remaining: 5.0,
            days_left: 30,
            repos_count: 0,
            max_capacity: 2
        }).catch(err => console.warn('D1 Save account notice:', err.message));

        // Sync with local models
        try {
            await createAccount({
                email: cleanEmail || `user${Date.now()}@mailu.site`,
                apiToken,
                initialCredits: 5.0,
                status: 'active'
            });
            await createLog({
                type: 'JIT_ACCOUNT_HARVESTED',
                message: `Harvested fresh Railway account stored in Cloudflare D1: ${cleanEmail}`,
                metadata: { accountId }
            });
        } catch (mErr) {
            console.warn('Local DB sync notice:', mErr.message);
        }

        // 3. Auto-deploy any waiting repository
        let deployedRepo = null;
        try {
            const waitingRepos = await queryD1("SELECT repo_name FROM repo_deployments WHERE deployment_status = 'PENDING_PROVISION' LIMIT 1;");
            if (waitingRepos && waitingRepos.length > 0) {
                const targetRepoName = waitingRepos[0].repo_name;
                const envs = await getD1RepoEnvs(targetRepoName);

                // Provision on Railway via API Token
                const project = await createRailwayProject(apiToken, targetRepoName.replace('/', '-'));
                const service = await createRailwayService(apiToken, project.projectId, targetRepoName.replace('/', '-'), targetRepoName);

                if (Object.keys(envs).length > 0) {
                    await setRailwayVariables(apiToken, project.projectId, project.environmentId, service.id, envs);
                }

                await triggerRailwayDeploy(apiToken, service.id, project.environmentId);

                const liveUrl = `https://${service.name}-production.up.railway.app`;
                await saveD1RepoDeployment({
                    repo_name: targetRepoName,
                    account_id: accountId,
                    railway_project_id: project.projectId,
                    railway_service_id: service.id,
                    deployment_status: 'DEPLOYED',
                    live_url: liveUrl
                });

                deployedRepo = targetRepoName;
            }
        } catch (deployErr) {
            console.warn('Auto-deploy pipeline notice:', deployErr.message);
        }

        return NextResponse.json({
            success: true,
            accountId,
            email: cleanEmail,
            deployedRepo
        });
    } catch (e) {
        console.error('POST /api/webhooks/account-ready error:', e.message);
        return NextResponse.json({ success: false, error: e.message }, { status: 500 });
    }
}
