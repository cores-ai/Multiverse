import { NextResponse } from 'next/server';
import { getRepositories, saveRepository } from '@/lib/models';
import { getD1RepoDeployments, saveD1RepoDeployment, saveD1RepoEnvs, getD1RepoEnvs, getRemoteConfig } from '@/lib/d1';
import { Octokit } from '@octokit/rest';

export async function GET() {
    try {
        const d1Repos = await getD1RepoDeployments();
        const mapped = (d1Repos || []).map(r => ({
            repoId: r.repo_name,
            repoName: r.repo_name,
            assignedAccountId: r.account_id,
            serviceType: 'HEAVY',
            branch: 'main',
            deploymentStatus: r.deployment_status || 'ACTIVE',
            liveUrl: r.live_url
        }));

        let githubCount = mapped.length;
        try {
            let token = await getRemoteConfig('GITHUB_TOKEN');
            if (!token || token.trim() === '') token = process.env.GITHUB_TOKEN;
            if (token && !token.includes('your_github_personal_access_token')) {
                const octokit = new Octokit({ auth: token });
                const { data: ghRepos } = await octokit.repos.listForAuthenticatedUser({ per_page: 100 });
                if (Array.isArray(ghRepos)) {
                    githubCount = ghRepos.length;
                }
            }
        } catch (e) {
            // fallback to mapped count if GitHub API is unreachable
        }

        const deadCount = mapped.filter(r => 
            ['FAILED', 'DEAD', 'CRASHED', 'ERROR'].includes((r.deploymentStatus || '').toUpperCase())
        ).length;

        return NextResponse.json({ 
            success: true, 
            repos: mapped,
            githubCount,
            deadCount
        });
    } catch (e) {
        console.error('Error fetching D1 repos:', e.message);
        return NextResponse.json({ success: true, repos: [], githubCount: 0, deadCount: 0 });
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
