import { NextResponse } from 'next/server';
import { deployRepositoryToRailway } from '@/lib/railway';
import { queryD1 } from '@/lib/d1';
import { createLog } from '@/lib/models';

/**
 * POST /api/repos/deploy
 * Body: { repoName: string, apiToken?: string, githubOrg?: string, customEnvs?: object }
 * Automatically deploys any specified repository to Railway using either
 * the provided token or the active token stored in Cloudflare D1 railway_accounts.
 * Injects all D1 environment variables associated with repoName.
 */
export async function POST(request) {
    try {
        const body = await request.json().catch(() => ({}));
        const repoName = body.repoName;
        let apiToken = body.apiToken || null;
        const githubOrg = body.githubOrg || 'cores-ai';
        const customEnvs = body.customEnvs || {};

        if (!repoName) {
            return NextResponse.json({ success: false, error: 'repoName is required' }, { status: 400 });
        }

        // 1. If apiToken is not provided in body, lookup the active token from Cloudflare D1
        if (!apiToken) {
            const accounts = await queryD1(
                "SELECT api_token FROM railway_accounts WHERE status = 'ACTIVE' ORDER BY created_at DESC LIMIT 1;"
            ).catch(() => []);

            if (accounts && accounts.length > 0 && accounts[0].api_token) {
                apiToken = accounts[0].api_token;
            }
        }

        if (!apiToken) {
            return NextResponse.json({
                success: false,
                error: 'No active Railway API token found in Cloudflare D1 or request body. Please provision or provide a token.'
            }, { status: 400 });
        }

        // 2. Execute full deployment pipeline
        const deployResult = await deployRepositoryToRailway({
            apiToken,
            repoName,
            githubOrg,
            customEnvs
        });

        await createLog({
            type: 'REPO_FLEET_DEPLOYED',
            message: `Successfully deployed ${repoName} onto Railway fleet with ${deployResult.injectedEnvCount} envs`,
            metadata: {
                repoName,
                projectId: deployResult.projectId,
                serviceId: deployResult.serviceId,
                liveUrl: deployResult.liveUrl
            }
        }).catch(() => {});

        return NextResponse.json({
            success: true,
            repoName,
            liveUrl: deployResult.liveUrl,
            projectId: deployResult.projectId,
            serviceId: deployResult.serviceId,
            envCount: deployResult.injectedEnvCount,
            timestamp: new Date().toISOString()
        });
    } catch (err) {
        console.error('POST /api/repos/deploy error:', err.message);
        return NextResponse.json({ success: false, error: err.message }, { status: 500 });
    }
}
