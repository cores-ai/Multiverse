import { NextResponse } from 'next/server';
import { getRepositories, saveRepository } from '@/lib/models';
import { getD1RepoDeployments, saveD1RepoDeployment, saveD1RepoEnvs, getD1RepoEnvs, getRemoteConfig, getD1RailwayAccounts, queryD1 } from '@/lib/d1';
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

        // Clean repo name: strip any stray main/master suffixes and clean characters
        let cleanRepoName = String(repoName || '')
            .trim()
            .toLowerCase()
            .replace(/\.[^/.]+$/, '')
            .replace(/-(main|master|dev|latest)$/i, '')
            .replace(/[^a-z0-9-]/g, '-')
            .replace(/-+/g, '-');

        // Pre-flight Security Audit: Scan files for leaked API keys
        const secretRegex = /((ghp_|gho_|github_pat_|railway_token|rly_tok_|sk-[a-zA-Z0-9]{20,}|eyJhbGciOi|bot_token=|telegram_bot=|[a-z0-9_]*(?:secret|apikey|private_key)\s*[:=]\s*["'][a-z0-9_\-]{8,}["']))/i;
        if (files && typeof files === 'object') {
            for (const [fname, fcontent] of Object.entries(files)) {
                const strContent = typeof fcontent === 'object' ? String(fcontent.content || '') : String(fcontent);
                if (secretRegex.test(strContent)) {
                    return NextResponse.json({
                        success: false,
                        error: `Security Alert: Private credential detected in file "${fname}". Remove secrets from repository code and use the Secrets / ENV card.`
                    }, { status: 400 });
                }
            }
        }

        // GitHub Integration: Auto-create repo under authenticated account and push full codebase
        let repoCreatedOnGitHub = false;
        let filesCommittedCount = 0;
        try {
            let token = await getRemoteConfig('GITHUB_TOKEN');
            if (!token || token.trim() === '') token = process.env.GITHUB_TOKEN;
            if (token && !token.includes('your_github_personal_access_token')) {
                const octokit = new Octokit({ auth: token.trim() });
                const { data: user } = await octokit.users.getAuthenticated();
                const owner = user.login;

                // 1. Create repo or verify existing
                try {
                    await octokit.repos.createForAuthenticatedUser({
                        name: cleanRepoName,
                        description: `Autopilot Multiverse Deployment: ${cleanRepoName}`,
                        private: true,
                        auto_init: true
                    });
                    repoCreatedOnGitHub = true;
                    console.log(`[GitHub API] Created new repository ${owner}/${cleanRepoName} successfully.`);
                } catch (ghErr) {
                    if (ghErr.status === 422) {
                        console.log(`[GitHub API] Repo ${cleanRepoName} already exists on GitHub. Ingesting codebase.`);
                        repoCreatedOnGitHub = true;
                    } else {
                        console.warn(`[GitHub API] Creation notice:`, ghErr.message);
                    }
                }

                // 2. Commit all uploaded codebase files to GitHub
                if (files && typeof files === 'object' && Object.keys(files).length > 0) {
                    try {
                        const fileEntries = Object.entries(files);
                        console.log(`[GitHub API] Ingesting ${fileEntries.length} files into ${owner}/${cleanRepoName}...`);

                        const { data: repoData } = await octokit.repos.get({ owner, repo: cleanRepoName });
                        const defaultBranch = repoData.default_branch || 'main';

                        const { data: refData } = await octokit.git.getRef({
                            owner,
                            repo: cleanRepoName,
                            ref: `heads/${defaultBranch}`
                        });
                        const parentCommitSha = refData.object.sha;

                        // Create Git Blobs
                        const treeEntries = [];
                        for (const [filePath, fileData] of fileEntries) {
                            const rawContent = typeof fileData === 'object' ? fileData.content : String(fileData);
                            const encoding = (typeof fileData === 'object' && fileData.encoding) || 'utf-8';

                            try {
                                const { data: blob } = await octokit.git.createBlob({
                                    owner,
                                    repo: cleanRepoName,
                                    content: rawContent,
                                    encoding: encoding === 'base64' ? 'base64' : 'utf-8'
                                });

                                treeEntries.push({
                                    path: filePath.replace(/^\/+/, ''),
                                    mode: '100644',
                                    type: 'blob',
                                    sha: blob.sha
                                });
                            } catch (bErr) {
                                console.warn(`[GitHub Blob Warning] Failed blob for ${filePath}:`, bErr.message);
                            }
                        }

                        if (treeEntries.length > 0) {
                            // Create Tree
                            const { data: tree } = await octokit.git.createTree({
                                owner,
                                repo: cleanRepoName,
                                tree: treeEntries
                            });

                            // Create Commit
                            const { data: newCommit } = await octokit.git.createCommit({
                                owner,
                                repo: cleanRepoName,
                                message: `feat(deploy): ingest complete repository codebase (${treeEntries.length} files)`,
                                tree: tree.sha,
                                parents: [parentCommitSha]
                            });

                            // Update Ref
                            await octokit.git.updateRef({
                                owner,
                                repo: cleanRepoName,
                                ref: `heads/${defaultBranch}`,
                                sha: newCommit.sha,
                                force: true
                            });

                            filesCommittedCount = treeEntries.length;
                            console.log(`✅ [GitHub API] Pushed ${filesCommittedCount} codebase files! Commit: ${newCommit.sha}`);
                        }
                    } catch (commitErr) {
                        console.error('[GitHub Full Ingest Error]:', commitErr.message);
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
                const available = accounts.find(a => (a.repos_count || 0) < (a.max_capacity || 2));
                if (available) {
                    targetAccountId = available.account_id;
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
            filesCommittedCount,
            assignedAccountId: targetAccountId
        });
    } catch (e) {
        return NextResponse.json({ success: false, error: e.message }, { status: 500 });
    }
}
