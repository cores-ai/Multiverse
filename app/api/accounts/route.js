import { NextResponse } from 'next/server';
import { getAccounts, createAccount, deleteAccount, createLog } from '@/lib/models';
import { getRailwayMe } from '@/lib/railway';
import { rebalanceFleetLoad } from '@/lib/balancer';

import { getD1RailwayAccounts, queryD1 } from '@/lib/d1';

export async function GET() {
    try {
        let accounts = [];
        
        // 1. Try fetching from Cloudflare D1 remote database
        try {
            const d1Accs = await getD1RailwayAccounts();
            if (Array.isArray(d1Accs) && d1Accs.length > 0) {
                accounts = d1Accs.map(a => ({
                    _id: a.account_id,
                    accountId: a.account_id,
                    email: a.email,
                    repoName: a.email,
                    apiTokenMasked: a.api_token ? `${a.api_token.substring(0, 8)}...` : 'None',
                    activeProjectsCount: a.repos_count || 0,
                    maxCapacity: a.max_capacity || 2,
                    remainingCredits: a.credits_remaining !== undefined ? a.credits_remaining : 5.0,
                    currency: 'USD',
                    status: (a.status || 'active').toLowerCase(),
                    createdAt: a.created_at || new Date().toISOString()
                }));
            }
        } catch (d1Err) {
            console.warn('[D1 Accounts Fetch Notice]:', d1Err.message);
        }

        // 2. Fallback to MongoDB / memory if D1 had no accounts
        if (accounts.length === 0) {
            const dbAccs = await getAccounts();
            accounts = dbAccs || [];
        }

        // 3. Deduplicate strictly by email and accountId
        const seen = new Set();
        const deduplicated = [];
        for (const acc of accounts) {
            const key = (acc.email || acc.accountId || acc._id || '').toLowerCase().trim();
            if (key && !seen.has(key)) {
                seen.add(key);
                deduplicated.push(acc);
            }
        }

        return NextResponse.json({ success: true, accounts: deduplicated });
    } catch (e) {
        return NextResponse.json({ success: false, error: e.message }, { status: 500 });
    }
}

export async function POST(request) {
    try {
        const body = await request.json();
        const { email, apiToken, initialCredits = 5.0, repoName } = body;

        if (!apiToken) {
            return NextResponse.json({ success: false, error: 'apiToken is required' }, { status: 400 });
        }

        // Verify token with Railway GraphQL API
        let verifiedEmail = email;
        try {
            const me = await getRailwayMe(apiToken);
            if (me && me.email) {
                verifiedEmail = me.email;
            }
        } catch (authErr) {
            console.warn('Could not verify Railway token online, proceeding with user-supplied details:', authErr.message);
        }

        // Sanitize email: strictly letters and numbers only, no underscores, no dots
        let sanitizedEmail = verifiedEmail;
        if (sanitizedEmail && sanitizedEmail.includes('@')) {
            const [u, d] = sanitizedEmail.split('@');
            sanitizedEmail = `${(u || '').replace(/[_.]/g, '')}@${d || 'mailu.site'}`;
        }

        const newAccount = await createAccount({
            email: sanitizedEmail || `user${Date.now()}@mailu.site`,
            repoName: repoName || null,
            apiToken,
            initialCredits: Number(initialCredits),
            status: 'active'
        });

        // Sync to Cloudflare D1 railway_accounts & link repository
        try {
            const { saveD1RailwayAccount } = await import('@/lib/d1');
            await saveD1RailwayAccount({
                account_id: newAccount.accountId,
                email: newAccount.email,
                api_token: apiToken,
                status: 'ACTIVE',
                credits_remaining: Number(initialCredits) || 5.0,
                days_left: 30,
                repos_count: 1,
                max_capacity: 2
            });

            const targetRepo = repoName || 'giveaway';
            await queryD1(
                `UPDATE repo_deployments 
                 SET account_id = ?, deployment_status = 'ACTIVE', live_url = ? 
                 WHERE repo_name = ?;`,
                [newAccount.accountId, `https://${targetRepo}.up.railway.app`, targetRepo]
            ).catch(() => {});
        } catch (d1Err) {
            console.warn('[D1 Account Sync Warning]:', d1Err.message);
        }

        await createLog({
            type: 'ACCOUNT_ADDED',
            message: `Railway account registered: ${newAccount.email} (${newAccount.accountId})`,
            metadata: { accountId: newAccount.accountId }
        });

        // Proactively rebalance fleet load: transfer repos from overloaded accounts to this new account
        let rebalanceInfo = null;
        try {
            rebalanceInfo = await rebalanceFleetLoad();
        } catch (balErr) {
            console.warn('Auto rebalance error:', balErr.message);
        }

        return NextResponse.json({
            success: true,
            account: {
                accountId: newAccount.accountId,
                email: newAccount.email,
                activeProjectsCount: newAccount.activeProjectsCount,
                maxCapacity: newAccount.maxCapacity,
                remainingCredits: newAccount.remainingCredits,
                status: newAccount.status
            },
            rebalanced: rebalanceInfo?.rebalanced || false,
            transferredCount: rebalanceInfo?.transferredCount || 0
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

        if (!accountId) {
            return NextResponse.json({ success: false, error: 'accountId is required' }, { status: 400 });
        }

        await deleteAccount(accountId);

        // Delete from Cloudflare D1
        try {
            await queryD1('UPDATE repo_deployments SET account_id = NULL WHERE account_id = ?;', [accountId]).catch(() => {});
            await queryD1('DELETE FROM railway_accounts WHERE account_id = ? OR email = ?;', [accountId, accountId]).catch(() => {});
        } catch (d1Err) {
            console.warn('[D1 Account Delete Notice]:', d1Err.message);
        }

        await createLog({
            type: 'ACCOUNT_DELETED',
            message: `Cluster removed: ${accountId}`,
            metadata: { accountId }
        });

        return NextResponse.json({ success: true, deleted: accountId });
    } catch (e) {
        console.error('DELETE /api/accounts error:', e.message);
        return NextResponse.json({ success: false, error: e.message }, { status: 500 });
    }
}
