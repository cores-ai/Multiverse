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

        if (!accountId) {
            return NextResponse.json({ success: false, error: 'accountId is required' }, { status: 400 });
        }

        // Delete from D1
        await deleteD1RailwayAccount(accountId).catch(err => console.warn('D1 delete notice:', err.message));

        // Delete from local
        await deleteAccount(accountId).catch(() => {});

        return NextResponse.json({ success: true, deleted: accountId });
    } catch (e) {
        console.error('DELETE /api/accounts error:', e.message);
        return NextResponse.json({ success: false, error: e.message }, { status: 500 });
    }
}
