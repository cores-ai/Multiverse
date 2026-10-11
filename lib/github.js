import { Octokit } from '@octokit/rest';

function getOctokit() {
    const token = process.env.GITHUB_TOKEN;
    if (!token) {
        throw new Error('GITHUB_TOKEN is not configured in environment variables.');
    }
    return new Octokit({ auth: token });
}

/**
 * Creates or verifies a GitHub repository under the authenticated user's account.
 */
export async function createGitHubRepo(repoName, isPrivate = true, description = 'Autonomous Railway Server Service') {
    const octokit = getOctokit();
    
    // Normalize repository name
    const sanitizedName = repoName.trim().toLowerCase().replace(/[^a-z0-9-_]/g, '-');
    
    try {
        // Try getting existing repo
        const user = await octokit.users.getAuthenticated();
        const owner = user.data.login;
        
        try {
            const existing = await octokit.repos.get({ owner, repo: sanitizedName });
            return {
                owner,
                repo: sanitizedName,
                fullName: existing.data.full_name,
                cloneUrl: existing.data.clone_url,
                htmlUrl: existing.data.html_url,
                defaultBranch: existing.data.default_branch || 'main',
                isNew: false
            };
        } catch (e) {
            // If 404, proceed to create
            if (e.status !== 404) throw e;
        }

        const created = await octokit.repos.createForAuthenticatedUser({
            name: sanitizedName,
            description,
            private: isPrivate,
            auto_init: true // Creates an initial commit with README.md so main branch exists
        });

        return {
            owner,
            repo: sanitizedName,
            fullName: created.data.full_name,
            cloneUrl: created.data.clone_url,
            htmlUrl: created.data.html_url,
            defaultBranch: created.data.default_branch || 'main',
            isNew: true
        };
    } catch (e) {
        console.error('Failed to create/get GitHub repo:', e.message);
        throw e;
    }
}

/**
 * Pushes multiple files to the GitHub repo in a single atomic commit using the Git Data API.
 * filesMap: { 'index.js': 'console.log("hello")', 'package.json': '{ ... }' }
 */
export async function commitFilesToRepo(owner, repo, filesMap, commitMessage = 'Deploy from Middleman Autonomous Ingestion', branch = 'main') {
    const octokit = getOctokit();

    try {
        // 1. Get latest commit SHA on the branch
        const refData = await octokit.git.getRef({
            owner,
            repo,
            ref: `heads/${branch}`
        });
        const latestCommitSha = refData.data.object.sha;

        // 2. Get tree of the latest commit
        const commitData = await octokit.git.getCommit({
            owner,
            repo,
            commit_sha: latestCommitSha
        });
        const baseTreeSha = commitData.data.tree.sha;

        // 3. Create tree items for each file
        const tree = [];
        for (const [filePath, content] of Object.entries(filesMap)) {
            tree.push({
                path: filePath,
                mode: '100644', // normal file
                type: 'blob',
                content: typeof content === 'string' ? content : JSON.stringify(content, null, 2)
            });
        }

        // 4. Create new Git Tree
        const newTree = await octokit.git.createTree({
            owner,
            repo,
            base_tree: baseTreeSha,
            tree
        });

        // 5. Create new Git Commit
        const newCommit = await octokit.git.createCommit({
            owner,
            repo,
            message: commitMessage,
            tree: newTree.data.sha,
            parents: [latestCommitSha]
        });

        // 6. Update branch reference to point to new commit
        await octokit.git.updateRef({
            owner,
            repo,
            ref: `heads/${branch}`,
            sha: newCommit.data.sha
        });

        return {
            commitSha: newCommit.data.sha,
            treeSha: newTree.data.sha
        };
    } catch (e) {
        console.error('Error committing files to GitHub:', e.message);
        throw e;
    }
}
