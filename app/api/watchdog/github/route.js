import { NextResponse } from 'next/server';
import { getRemoteConfig, getD1RepoDeployments } from '@/lib/d1';
import { Octokit } from '@octokit/rest';

/**
 * Autonomous GitHub Health & Telemetry Watchdog
 * GET /api/watchdog/github
 * Strictly monitors active repositories uploaded and registered in Cloudflare D1.
 * Does NOT auto-import random external repositories from GitHub account into D1.
 */
export async function GET() {
    try {
        let gitHubToken = await getRemoteConfig('GITHUB_TOKEN');
        if (!gitHubToken || gitHubToken.trim() === '') {
            gitHubToken = process.env.GITHUB_TOKEN;
        }

        if (!gitHubToken || gitHubToken.includes('your_github_personal_access_token')) {
            return NextResponse.json({
                success: true,
                message: 'GitHub token standby.',
                waitingConfig: true,
                timestamp: new Date().toISOString()
            });
        }

        // Fetch user-deployed repositories directly from Cloudflare D1
        const existingDeployments = await getD1RepoDeployments();

        if (!existingDeployments || existingDeployments.length === 0) {
            return NextResponse.json({
                success: true,
                totalDeployed: 0,
                newReposDetected: 0,
                message: 'No user uploaded repositories in D1. Watchdog in standby.',
                timestamp: new Date().toISOString()
            });
        }

        const octokit = new Octokit({ auth: gitHubToken });

        // Verify status of actively deployed user repositories
        const activeStatuses = [];
        for (const dep of existingDeployments) {
            try {
                const [owner, repo] = (dep.repo_name || '').split('/');
                if (owner && repo) {
                    const { data } = await octokit.repos.get({ owner, repo });
                    activeStatuses.push({
                        repo: dep.repo_name,
                        status: 'OK',
                        pushed_at: data.pushed_at
                    });
                }
            } catch (err) {
                activeStatuses.push({
                    repo: dep.repo_name,
                    status: 'NOT_FOUND_OR_ERROR',
                    error: err.message
                });
            }
        }

        return NextResponse.json({
            success: true,
            totalDeployed: existingDeployments.length,
            newReposDetected: 0,
            activeStatuses,
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
