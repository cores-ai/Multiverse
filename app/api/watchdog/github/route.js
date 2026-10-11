import { NextResponse } from 'next/server';
import { getRemoteConfig, getD1RepoDeployments, saveD1RepoDeployment, getD1RailwayAccounts, queryD1 } from '@/lib/d1';
import { Octokit } from '@octokit/rest';
import { spawn } from 'child_process';
import path from 'path';

/**
 * 30-Second GitHub Polling Watchdog
 * GET /api/watchdog/github
 * 1. Reads GITHUB_TOKEN directly from Cloudflare D1 (remote_config) or process.env.
 * 2. Fetches all accessible repositories (public and private).
 * 3. Compares against deployed repos in Cloudflare D1.
 * 4. For any new repository:
 *    - Automatically initiates the JIT cluster generation pipeline.
 *    - Steps run with strict 2-second spacing.
 */
export async function GET() {
    try {
        // Step 1: Resolve GitHub Token from Cloudflare D1
        let gitHubToken = await getRemoteConfig('GITHUB_TOKEN');
        if (!gitHubToken || gitHubToken.trim() === '') {
            gitHubToken = process.env.GITHUB_TOKEN;
        }

        if (!gitHubToken || gitHubToken.includes('your_github_personal_access_token')) {
            return NextResponse.json({
                success: true,
                message: 'GitHub token not yet set in Cloudflare D1 remote_config. Watchdog standby.',
                waitingConfig: true,
                timestamp: new Date().toISOString()
            });
        }

        const octokit = new Octokit({ auth: gitHubToken });

        // Step 2: Fetch all user repos (public + private + orgs)
        const { data: repos } = await octokit.repos.listForAuthenticatedUser({
            per_page: 100,
            sort: 'updated',
            direction: 'desc'
        });

        // Step 3: Fetch existing known deployments in D1
        const existingDeployments = await getD1RepoDeployments();
        const knownRepoNames = new Set(existingDeployments.map(d => d.repo_name.toLowerCase()));

        const detectedNewRepos = [];

        for (const repo of repos) {
            const fullName = repo.full_name.toLowerCase();
            const simpleName = repo.name.toLowerCase();

            if (!knownRepoNames.has(fullName) && !knownRepoNames.has(simpleName)) {
                detectedNewRepos.push({
                    name: repo.name,
                    full_name: repo.full_name,
                    private: repo.private,
                    clone_url: repo.clone_url,
                    html_url: repo.html_url,
                    default_branch: repo.default_branch
                });
            }
        }

        const triggeredPipelines = [];

        // Step 4: For any new repo, trigger JIT generation with 2-second pacing
        for (const newRepo of detectedNewRepos) {
            // Register as PENDING_PROVISION in Cloudflare D1
            await saveD1RepoDeployment({
                repo_name: newRepo.full_name,
                deployment_status: 'PENDING_PROVISION',
                live_url: null
            });

            // Trigger JIT Railway creation pipeline via local API
            const pipelineRes = await fetch(`${process.env.NEXT_PUBLIC_BASE_URL || 'http://localhost:3000'}/api/railway/harvest`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ clusterName: newRepo.name })
            }).then(r => r.json()).catch(err => ({ success: false, error: err.message }));

            triggeredPipelines.push({
                repo: newRepo.full_name,
                pipelineStatus: pipelineRes.success ? 'STARTED' : 'FAILED',
                details: pipelineRes
            });

            // Maintain strictly a 2-second spacing between multiple repo creations
            if (detectedNewRepos.length > 1) {
                await new Promise(r => setTimeout(r, 2000));
            }
        }

        return NextResponse.json({
            success: true,
            totalGitHubRepos: repos.length,
            newReposDetected: detectedNewRepos.length,
            triggeredPipelines,
            timestamp: new Date().toISOString()
        });
    } catch (err) {
        console.error('GitHub Watchdog Error:', err);
        return NextResponse.json({
            success: false,
            error: err.message
        }, { status: 500 });
    }
}
