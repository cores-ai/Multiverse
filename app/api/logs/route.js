import { NextResponse } from 'next/server';
import { getRecentLogs } from '@/lib/models';

export async function GET() {
    try {
        const logs = await getRecentLogs(30);
        return NextResponse.json({ success: true, logs });
    } catch (e) {
        return NextResponse.json({ success: false, error: e.message }, { status: 500 });
    }
}
