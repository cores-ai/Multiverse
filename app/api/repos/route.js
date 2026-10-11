import { NextResponse } from 'next/server';
import { getRepositories, saveRepository } from '@/lib/models';
import { getD1RepoDeployments, saveD1RepoDeployment, saveD1RepoEnvs, getD1RepoEnvs } from '@/lib/d1';

export async function GET() {
    try {
        const d1Repos = await getD1RepoDeployments().catch(() => []);
        if (d1Repos && d1Repos.length > 0) {
            const mapped = d1Repos.map(r => ({
                repoId: r.repo_name,
                repoName: r.repo_name,
                assignedAccountId: r.account_id,
                serviceType: 'HEAVY',
                branch: 'main',
                deploymentStatus: r.deployment_status,
                liveUrl: r.live_url
            }));
            return NextResponse.json({ success: true, repos: mapped });
        }

        const repos = await getRepositories();
        return NextResponse.json({ success: true, repos });
    } catch (e) {
        return NextResponse.json({ success: false, error: e.message }, { status: 500 });
    }
}

export async function POST(request) {
    try {
        const body = await request.json();
        const { repoName, serviceType = 'HEAVY', assignedAccountId, githubUrl, envs } = body;

        if (!repoName) {
            return NextResponse.json({ success: false, error: 'repoName is required' }, { status: 400 });
        }

        // Save into Cloudflare D1
        await saveD1RepoDeployment({
            repo_name: repoName,
            account_id: assignedAccountId || null,
            deployment_status: 'ACTIVE',
            live_url: `https://${repoName.split('@')[0].replace(/[^a-z0-9]/gi, '')}.up.railway.app`
        }).catch(err => console.warn('D1 Repo save notice:', err.message));

        // Parse and save envs to D1 if provided
        if (envs) {
            const envMap = {};
            const lines = envs.split('\n');
            for (const line of lines) {
                const parts = line.split('=');
                if (parts.length >= 2) {
                    envMap[parts[0].trim()] = parts.slice(1).join('=').trim();
                }
            }
            if (Object.keys(envMap).length > 0) {
                await saveD1RepoEnvs(repoName, envMap).catch(() => {});
            }
        }

        // Also save to local model
        const saved = await saveRepository({
            repoName,
            serviceType,
            assignedAccountId,
            githubUrl: githubUrl || `https://github.com/iq4u8/${repoName}`,
            deploymentStatus: 'ACTIVE',
            liveUrl: `https://${repoName.split('@')[0].replace(/[^a-z0-9]/gi, '')}.up.railway.app`
        }).catch(() => ({ repoName, deploymentStatus: 'ACTIVE' }));

        return NextResponse.json({ success: true, repository: saved });
    } catch (e) {
        return NextResponse.json({ success: false, error: e.message }, { status: 500 });
    }
}
