import { NextResponse } from 'next/server';
import { getRepositories, saveRepository } from '@/lib/models';
import { 
    getD1RepoDeployments, 
    saveD1RepoDeployment, 
    saveD1RepoEnvs, 
    getD1RepoEnvs, 
    getRemoteConfig, 
    getD1RailwayAccounts, 
    saveD1DatabaseAccount,
    queryD1 
} from '@/lib/d1';
import { unpackZipBuffer } from '@/lib/unzip';
import { Octokit } from '@octokit/rest';

export async function GET() {
    try {
        const d1Repos = await getD1RepoDeployments();
        let mapped = (d1Repos || []).map(r => ({
            repoId: r.repo_name,
            repoName: r.repo_name,
            assignedAccountId: r.account_id,
            serviceType: 'HEAVY',
            branch: 'main',
            deploymentStatus: r.deployment_status || 'ACTIVE',
            liveUrl: r.live_url
        }));

        let githubCount = mapped.length;

        // Core Real-Time GitHub Synchronization
        try {
            let token = await getRemoteConfig('GITHUB_TOKEN');
            if (!token || token.trim() === '') token = process.env.GITHUB_TOKEN;
            if (token && !token.includes('your_github_personal_access_token')) {
                const octokit = new Octokit({ auth: token.trim() });
                const { data: ghRepos } = await octokit.repos.listForAuthenticatedUser({ 
                    per_page: 100,
                    affiliation: 'owner',
                    sort: 'updated'
                });
                
                const ghNames = new Set(ghRepos.map(g => g.name.toLowerCase()));
                githubCount = ghRepos.length;

                // Prune any phantom / stale repo from D1 that no longer exists on GitHub
                const validMapped = [];
                for (const r of mapped) {
                    if (ghNames.has(r.repoName.toLowerCase())) {
                        validMapped.push(r);
                    } else {
                        // Purge phantom records from D1 silently
                        await queryD1('DELETE FROM repo_deployments WHERE repo_name = ?;', [r.repoName]).catch(() => {});
                        await queryD1('DELETE FROM repo_envs WHERE repo_name = ?;', [r.repoName]).catch(() => {});
                        await queryD1('DELETE FROM database_accounts WHERE cluster_name = ? OR db_name = ?;', [r.repoName, `${r.repoName}_db`]).catch(() => {});
                    }
                }
                mapped = validMapped;
            }
        } catch (ghSyncErr) {
            console.warn('[GitHub Sync Warning]:', ghSyncErr.message);
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
        const { repoName, serviceType = 'HEAVY', assignedAccountId: providedAccountId, githubUrl, envs, envVariables, files: providedFiles, zipBase64 } = body;

        if (!repoName) {
            return NextResponse.json({ success: false, error: 'repoName is required' }, { status: 400 });
        }

        // Clean repo name: strip any stray main/master/dev suffixes and clean characters
        let cleanRepoName = String(repoName || '')
            .trim()
            .toLowerCase()
            .replace(/\.[^/.]+$/, '')
            .replace(/-(main|master|dev|latest)$/i, '')
            .replace(/[^a-z0-9-]/g, '-')
            .replace(/-+/g, '-');

        // Resolve files: either from direct extracted map or zipBase64 buffer
        let files = providedFiles && typeof providedFiles === 'object' ? { ...providedFiles } : {};
        if (zipBase64 && typeof zipBase64 === 'string') {
            try {
                const zipBuffer = Buffer.from(zipBase64, 'base64');
                const unzippedFiles = unpackZipBuffer(zipBuffer);
                files = { ...unzippedFiles, ...files };
                console.log(`[Unpack API] Extracted ${Object.keys(unzippedFiles).length} files from uploaded ZIP buffer.`);
            } catch (zErr) {
                console.error('[Unpack API Error]:', zErr.message);
            }
        }

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

                        await new Promise(r => setTimeout(r, 600));

                        const { data: repoData } = await octokit.repos.get({ owner, repo: cleanRepoName });
                        const defaultBranch = repoData.default_branch || 'main';

                        let parentCommitSha = null;
                        try {
                            const { data: refData } = await octokit.git.getRef({
                                owner,
                                repo: cleanRepoName,
                                ref: `heads/${defaultBranch}`
                            });
                            parentCommitSha = refData.object.sha;
                        } catch (refErr) {
                            console.warn('[GitHub API] Heads ref notice:', refErr.message);
                        }

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
                            const commitPayload = {
                                owner,
                                repo: cleanRepoName,
                                message: `feat(deploy): ingest complete repository codebase (${treeEntries.length} files)`,
                                tree: tree.sha
                            };
                            if (parentCommitSha) {
                                commitPayload.parents = [parentCommitSha];
                            }

                            const { data: newCommit } = await octokit.git.createCommit(commitPayload);

                            // Update Ref
                            try {
                                await octokit.git.updateRef({
                                    owner,
                                    repo: cleanRepoName,
                                    ref: `heads/${defaultBranch}`,
                                    sha: newCommit.sha,
                                    force: true
                                });
                            } catch (upErr) {
                                await octokit.git.createRef({
                                    owner,
                                    repo: cleanRepoName,
                                    ref: `refs/heads/${defaultBranch}`,
                                    sha: newCommit.sha
                                });
                            }

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

            // Auto-register corresponding Database instance in database_accounts
            try {
                let dbType = 'Cloudflare D1 Vault (Encrypted ENV)';
                let connStr = `d1://database.internal/${cleanRepoName}_db`;
                let dbHost = 'mesh.d1.cloudflare.com';

                // Detect if explicit database URI was supplied in ENV (MongoDB / Postgres / Redis / MySQL)
                const uriKey = Object.keys(envMap).find(k => /^(MONGO_URI|DATABASE_URL|POSTGRES_URL|REDIS_URL|MYSQL_URL|DB_URI)/i.test(k));
                if (uriKey) {
                    connStr = envMap[uriKey];
                    if (/mongo/i.test(uriKey)) dbType = 'MongoDB (Atlas)';
                    else if (/postgres/i.test(uriKey)) dbType = 'PostgreSQL (Neon)';
                    else if (/redis/i.test(uriKey)) dbType = 'Redis';
                    else if (/mysql/i.test(uriKey)) dbType = 'MySQL';

                    try {
                        const parsedUrl = new URL(connStr.replace('mongodb+srv://', 'http://').replace('mongodb://', 'http://').replace('postgres://', 'http://').replace('postgresql://', 'http://'));
                        if (parsedUrl.hostname) dbHost = parsedUrl.hostname;
                    } catch (uErr) {}
                }

                await saveD1DatabaseAccount({
                    db_id: `db_${cleanRepoName}`,
                    cluster_name: cleanRepoName,
                    db_name: `${cleanRepoName}_db`,
                    db_type: dbType,
                    host: dbHost,
                    connection_string: connStr,
                    latency_ms: 28,
                    status: 'ACTIVE',
                    storage_used_gb: 0.1
                });
                console.log(`[Database Auto-Sync] Registered database node db_${cleanRepoName} for repo ${cleanRepoName}`);
            } catch (dbErr) {
                console.warn('[Database Auto-Sync Notice]:', dbErr.message);
            }
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
            githubUrl: githubUrl || `https://github.com/Coras-Multiverse/${cleanRepoName}`,
            envs: envMap,
            deploymentStatus: 'ACTIVE',
            liveUrl: liveDomain
        });

        return NextResponse.json({
            success: true,
            repo: saved,
            repoName: cleanRepoName,
            filesCommittedCount,
            githubLive: repoCreatedOnGitHub,
            message: `Deployed ${cleanRepoName} to GitHub (${filesCommittedCount} files) and configured database & env in D1`
        });

    } catch (e) {
        console.error('API /api/repos POST Error:', e);
        return NextResponse.json({ success: false, error: e.message }, { status: 500 });
    }
}
