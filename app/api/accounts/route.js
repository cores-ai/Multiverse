import { NextResponse } from 'next/server';
import { getAccounts, createAccount, deleteAccount, createLog } from '@/lib/models';
import { getRailwayMe } from '@/lib/railway';
import { rebalanceFleetLoad } from '@/lib/balancer';

import { getD1RailwayAccounts, queryD1 } from '@/lib/d1';

export async function GET() {
    try {
        let accounts = [];
        let d1Loaded = false;
        // 1. Try fetching from Cloudflare D1 remote database
        try {
            const d1Accs = await getD1RailwayAccounts();
            if (Array.isArray(d1Accs)) {
                d1Loaded = true;
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

        // 2. Only fallback to MongoDB / memory if D1 connection threw an error
        if (!d1Loaded) {
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
        const email = searchParams.get('email');

        if (!accountId && !email) {
            return NextResponse.json({ success: false, error: 'accountId or email is required' }, { status: 400 });
        }

        // Delegate to autonomous delete-account route logic to ensure real Railway deletion
        const baseUrl = process.env.MIDDLEMAN_WEBHOOK_URL ? new URL(process.env.MIDDLEMAN_WEBHOOK_URL).origin : 'http://localhost:3000';
        const res = await fetch(`${baseUrl}/api/railway/delete-account`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ accountId, email })
        });
        const data = await res.json();
        return NextResponse.json(data);
    } catch (e) {
        console.error('DELETE /api/accounts error:', e.message);
        return NextResponse.json({ success: false, error: e.message }, { status: 500 });
    }
}
