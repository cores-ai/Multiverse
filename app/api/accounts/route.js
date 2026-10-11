import { NextResponse } from 'next/server';
import { getAccounts, createAccount, deleteAccount, createLog } from '@/lib/models';
import { getD1RailwayAccounts, saveD1RailwayAccount, deleteD1RailwayAccount } from '@/lib/d1';
import { getRailwayMe } from '@/lib/railway';

export async function GET() {
    try {
        // Cloudflare D1 is the strict single source of truth
        const d1Accounts = await getD1RailwayAccounts();
        const mapped = (d1Accounts || []).map(a => ({
            accountId: a.account_id,
            email: a.email,
            repoName: a.email,
            remainingCredits: Number(a.credits_remaining || 5.0),
            activeProjectsCount: Number(a.repos_count || 0),
            maxCapacity: Number(a.max_capacity || 2),
            status: (a.status || 'active').toLowerCase(),
            createdAt: a.created_at
        }));
        return NextResponse.json({ success: true, accounts: mapped });
    } catch (e) {
        console.error('Error fetching D1 accounts:', e.message);
        return NextResponse.json({ success: true, accounts: [] });
    }
}

export async function POST(request) {
    try {
        const body = await request.json();
        const { email, apiToken, initialCredits = 5.0, repoName } = body;

        if (!apiToken) {
            return NextResponse.json({ success: false, error: 'apiToken is required' }, { status: 400 });
        }

        // Sanitize email: strictly letters and numbers only, no underscores, no dots
        let sanitizedEmail = email;
        if (sanitizedEmail && sanitizedEmail.includes('@')) {
            const [u, d] = sanitizedEmail.split('@');
            sanitizedEmail = `${(u || '').replace(/[_.]/g, '')}@${d || 'mailu.site'}`;
        }

        const accountId = `rly_${Date.now().toString(36)}_${Math.random().toString(36).substring(2, 6)}`;

        // Save into Cloudflare D1
        await saveD1RailwayAccount({
            account_id: accountId,
            email: sanitizedEmail || `user${Date.now()}@mailu.site`,
            api_token: apiToken,
            status: 'ACTIVE',
            credits_remaining: Number(initialCredits),
            days_left: 30,
            repos_count: 0,
            max_capacity: 2
        }).catch(err => console.warn('D1 account insert notice:', err.message));

        // Also save to local model
        const newAccount = await createAccount({
            email: sanitizedEmail || `user${Date.now()}@mailu.site`,
            repoName: repoName || null,
            apiToken,
            initialCredits: Number(initialCredits),
            status: 'active'
        }).catch(() => ({
            accountId,
            email: sanitizedEmail,
            activeProjectsCount: 0,
            maxCapacity: 2,
            remainingCredits: initialCredits,
            status: 'active'
        }));

        return NextResponse.json({
            success: true,
            account: {
                accountId: newAccount.accountId || accountId,
                email: sanitizedEmail,
                activeProjectsCount: 0,
                maxCapacity: 2,
                remainingCredits: Number(initialCredits),
                status: 'active'
            }
        });
    } catch (e) {
        console.error('POST /api/accounts error:', e.message);
        return NextResponse.json({ success: false, error: e.message }, { status: 500 });
    }
}

export async function DELETE(request) {
    try {
        const { searchParams } = new URL(request.url);
        const accountId = searchParams.get('accountId');
        const emailParam = searchParams.get('email');

        if (!accountId) {
            return NextResponse.json({ success: false, error: 'accountId is required' }, { status: 400 });
        }

        // Find account in D1 to get email and token
        let targetEmail = emailParam;
        let apiToken = null;
        try {
            const d1Accounts = await getD1RailwayAccounts();
            const found = (d1Accounts || []).find(a => 
                a.account_id === accountId || 
                a.accountId === accountId || 
                a.email === accountId || 
                (emailParam && a.email === emailParam)
            );
            if (found) {
                targetEmail = targetEmail || found.email;
                apiToken = found.api_token || found.apiToken;
            }
        } catch (e) {}

        // 1. If API Token exists, clean up any Railway projects via GraphQL
        if (apiToken) {
            try {
                const gqlRes = await fetch('https://backboard.railway.com/graphql/v2', {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        'Authorization': `Bearer ${apiToken}`
                    },
                    body: JSON.stringify({
                        query: `query { projects { edges { node { id } } } }`
                    })
                });
                const gqlData = await gqlRes.json();
                const projects = gqlData?.data?.projects?.edges || [];
                for (const edge of projects) {
                    const pid = edge.node?.id;
                    if (pid) {
                        await fetch('https://backboard.railway.com/graphql/v2', {
                            method: 'POST',
                            headers: {
                                'Content-Type': 'application/json',
                                'Authorization': `Bearer ${apiToken}`
                            },
                            body: JSON.stringify({
                                query: `mutation DeleteProject($id: String!) { projectDelete(id: $id) }`,
                                variables: { id: pid }
                            })
                        }).catch(() => {});
                    }
                }
            } catch (gqlErr) {
                console.warn('Railway project cleanup note:', gqlErr.message);
            }
        }

        // 2. Launch autonomous Railway account deletion worker if email is present
        if (targetEmail) {
            try {
                const { spawn } = await import('child_process');
                const path = await import('path');
                const fs = await import('fs');

                const possibleDirs = [
                    path.resolve(process.cwd(), '..', 'Rilway Server'),
                    path.resolve(process.cwd(), 'railway-worker'),
                    path.resolve(process.cwd(), '..', 'railway-worker')
                ];

                let workerDir = null;
                let workerScript = null;

                for (const d of possibleDirs) {
                    const s = path.join(d, 'delete_worker.js');
                    if (fs.existsSync(s)) {
                        workerDir = d;
                        workerScript = s;
                        break;
                    }
                }

                if (workerScript) {
                    console.log(`🚀 [Multiverse Delete] Spawning Railway account deleter for: ${targetEmail}`);
                    const delProc = spawn(process.execPath, [workerScript, targetEmail], {
                        cwd: workerDir,
                        detached: true,
                        stdio: 'ignore',
                        env: {
                            ...process.env,
                            TARGET_EMAIL: targetEmail,
                            HEADLESS: 'true'
                        }
                    });
                    delProc.unref();
                }
            } catch (delSpawnErr) {
                console.warn('Autonomous deletion spawn error:', delSpawnErr.message);
            }
        }

        // 3. Delete from D1 and local DB
        await deleteD1RailwayAccount(accountId).catch(err => console.warn('D1 delete notice:', err.message));
        await deleteAccount(accountId).catch(() => {});

        return NextResponse.json({ success: true, deleted: accountId, email: targetEmail });
    } catch (e) {
        console.error('DELETE /api/accounts error:', e.message);
        return NextResponse.json({ success: false, error: e.message }, { status: 500 });
    }
}
