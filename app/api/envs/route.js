import { NextResponse } from 'next/server';
import { getRepoEnvVariables, saveRepoEnvVariables, getRepositoryById, getAccounts, createLog } from '@/lib/models';
import { setRailwayVariables } from '@/lib/railway';

export async function GET(request) {
    try {
        const { searchParams } = new URL(request.url);
        const repoId = searchParams.get('repoId');

        if (!repoId) {
            return NextResponse.json({ success: false, error: 'repoId query param is required' }, { status: 400 });
        }

        const envData = await getRepoEnvVariables(repoId);
        return NextResponse.json({ success: true, ...envData });
    } catch (e) {
        return NextResponse.json({ success: false, error: e.message }, { status: 500 });
    }
}

export async function POST(request) {
    try {
        const body = await request.json();
        const { repoId, variables } = body;

        if (!repoId || !variables || typeof variables !== 'object') {
            return NextResponse.json({ success: false, error: 'repoId and variables object are required' }, { status: 400 });
        }

        // 1. Save to MongoDB (strictly linked and versioned)
        const saved = await saveRepoEnvVariables(repoId, variables);

        // 2. Fetch repo metadata to sync live to Railway if active
        const repo = await getRepositoryById(repoId);
        let railwaySynced = false;

        if (repo && repo.assignedAccountId && repo.railwayProjectId && repo.railwayServiceId) {
            const accounts = await getAccounts();
            const account = accounts.find(a => a.accountId === repo.assignedAccountId);

            if (account && account.apiToken) {
                try {
                    await setRailwayVariables(
                        account.apiToken,
                        repo.railwayProjectId,
                        repo.environmentId || null,
                        repo.railwayServiceId,
                        variables
                    );
                    railwaySynced = true;
                } catch (rlyErr) {
                    console.error('Failed to sync updated variables to Railway:', rlyErr.message);
                }
            }
        }

        await createLog({
            type: 'ENVS_UPDATED',
            message: `Updated environment variables for ${repoId} (v${saved.version})`,
            metadata: { repoId, version: saved.version, railwaySynced }
        });

        return NextResponse.json({
            success: true,
            version: saved.version,
            keys: saved.keys,
            railwaySynced
        });
    } catch (e) {
        console.error('POST /api/envs error:', e.message);
        return NextResponse.json({ success: false, error: e.message }, { status: 500 });
    }
}
