import { NextResponse } from 'next/server';
import { getAccounts, getRepositories } from '@/lib/models';
import { rebalanceFleetLoad } from '@/lib/balancer';

export async function GET() {
    try {
        const accounts = await getAccounts();
        const repos = await getRepositories();

        const totalSlots = accounts.length * 2;
        const usedSlots = repos.length;
        const loadRatio = totalSlots > 0 ? (usedSlots / totalSlots) : 1;

        // Health tier calculation
        let tier = 'green';
        let emoji = '🟢';
        let healthPct = 95;
        let status = 'Healthy & Balanced';

        if (accounts.length === 0) {
            tier = 'red';
            emoji = '🔴';
            healthPct = 0;
            status = 'No Accounts Connected';
        } else if (loadRatio >= 0.85) {
            tier = 'red';
            emoji = '🔴';
            healthPct = Math.max(20, Math.round(100 - (loadRatio * 70)));
            status = 'Fleet Overloaded';
        } else if (loadRatio >= 0.50) {
            tier = 'yellow';
            emoji = '🟡';
            healthPct = Math.min(Math.max(Math.round(100 - (loadRatio * 45)), 55), 84);
            status = 'High Load (Balanced)';
        } else {
            tier = 'green';
            emoji = '🟢';
            healthPct = Math.min(Math.max(Math.round(98 - (loadRatio * 16)), 88), 99);
            status = 'Optimal & Balanced';
        }

        return NextResponse.json({
            success: true,
            health: {
                percentage: healthPct,
                emoji,
                tier,
                status,
                totalSlots,
                usedSlots,
                loadPercentage: Math.round(loadRatio * 100),
                accountCount: accounts.length,
                repoCount: repos.length
            }
        });
    } catch (e) {
        return NextResponse.json({ success: false, error: e.message }, { status: 500 });
    }
}

export async function POST() {
    try {
        const result = await rebalanceFleetLoad();
        return NextResponse.json({ success: true, ...result });
    } catch (e) {
        return NextResponse.json({ success: false, error: e.message }, { status: 500 });
    }
}
