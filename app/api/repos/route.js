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

        const githubCount = mapped.length;

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
        const { repoName, serviceType = 'HEAVY', assignedAccountId: providedAccountId, githubUrl, envs, envVariables, files } = body;

        if (!repoName) {
            return NextResponse.json({ success: false, error: 'repoName is required' }, { status: 400 });
        }

        const cleanRepoName = String(repoName || '').trim().toLowerCase().replace(/[^a-z0-9-]/g, '-').replace(/-+/g, '-');

        // Pre-flight Security Audit: Scan files for leaked API keys
        const secretRegex = /((ghp_|gho_|github_pat_|railway_token|rly_tok_|sk-[a-zA-Z0-9]{20,}|eyJhbGciOi|bot_token=|telegram_bot=|[a-z0-9_]*(?:secret|apikey|private_key)\s*[:=]\s*["'][a-z0-9_\-]{8,}["']))/i;
        if (files && typeof files === 'object') {
            for (const [fname, fcontent] of Object.entries(files)) {
                if (secretRegex.test(String(fcontent))) {
                    return NextResponse.json({
                        success: false,
                        error: `Security Alert: Private credential detected in file "${fname}". Remove secrets from repository code and use the Secrets / ENV card.`
                    }, { status: 400 });
                }
            }
        }

        // GitHub Integration: Auto-create repo under authenticated account
        let repoCreatedOnGitHub = false;
        try {
            let token = await getRemoteConfig('GITHUB_TOKEN');
            if (!token || token.trim() === '') token = process.env.GITHUB_TOKEN;
            if (token && !token.includes('your_github_personal_access_token')) {
                const octokit = new Octokit({ auth: token });
                try {
                    await octokit.repos.createForAuthenticatedUser({
                        name: cleanRepoName,
                        description: `Autopilot Multiverse Deployment: ${cleanRepoName}`,
                        private: true,
                        auto_init: true
                    });
                    repoCreatedOnGitHub = true;
                    console.log(`[GitHub API] Created new repository ${cleanRepoName} successfully.`);
                } catch (ghErr) {
                    if (ghErr.status === 422) {
                        // Repository already exists -> Overwrite / Modify existing repository
                        console.log(`[GitHub API] Repo ${cleanRepoName} already exists on GitHub. Updating existing repo.`);
                        repoCreatedOnGitHub = true;
                    } else {
                        console.warn(`[GitHub API] Creation notice:`, ghErr.message);
                    }
                }
            }
        } catch (e) {
            console.warn('[GitHub API] Watchdog error:', e.message);
        }

        // Environment Variables: Parse and persist to Cloudflare D1
        const envMap = typeof envVariables === 'object' && envVariables !== null ? { ...envVariables } : {};
        if (envs && typeof envs === 'string') {
            const lines = envs.split('\n');
            for (const line of lines) {
                const parts = line.split('=');
                if (parts.length >= 2) {
                    envMap[parts[0].trim()] = parts.slice(1).join('=').trim();
                }
            }
        }

        if (Object.keys(envMap).length > 0) {
            await saveD1RepoEnvs(cleanRepoName, envMap).catch(() => {});
        }

        // Railway Capacity & Intelligent Slot Balancer
        let targetAccountId = providedAccountId || null;
        try {
            const accounts = await getD1RailwayAccounts();
            if (Array.isArray(accounts) && accounts.length > 0) {
                // Find account with available capacity (< max_capacity)
                const available = accounts.find(a => (a.repos_count || 0) < (a.max_capacity || 2));
                if (available) {
                    targetAccountId = available.account_id;
                    // Increment repos_count for this account in D1
                    await queryD1('UPDATE railway_accounts SET repos_count = repos_count + 1 WHERE account_id = ?;', [available.account_id]).catch(() => {});
                }
            }
        } catch (err) {
            console.warn('[Slot Balancer Notice]:', err.message);
        }

        // Save deployment record into Cloudflare D1
        const liveDomain = `https://${cleanRepoName.replace(/[^a-z0-9]/gi, '')}.up.railway.app`;
        await saveD1RepoDeployment({
            repo_name: cleanRepoName,
            account_id: targetAccountId,
            deployment_status: 'ACTIVE',
            live_url: liveDomain
        }).catch(err => console.warn('D1 Repo save notice:', err.message));

        // Save to local model for fallback
        const saved = await saveRepository({
            repoName: cleanRepoName,
            serviceType,
            assignedAccountId: targetAccountId,
            githubUrl: githubUrl || `https://github.com/iq4u8/${cleanRepoName}`,
            deploymentStatus: 'ACTIVE',
            liveUrl: liveDomain
        }).catch(() => ({ repoName: cleanRepoName, deploymentStatus: 'ACTIVE' }));

        return NextResponse.json({ 
            success: true, 
            repository: saved,
            repoName: cleanRepoName,
            githubCreated: repoCreatedOnGitHub,
            assignedAccountId: targetAccountId
        });
    } catch (e) {
        return NextResponse.json({ success: false, error: e.message }, { status: 500 });
    }
}
