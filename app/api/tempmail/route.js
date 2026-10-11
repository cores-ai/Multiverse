import { NextResponse } from 'next/server';
import { generateTempEmail, fetchRawOtp } from '@/lib/tempmail';
import { createLog } from '@/lib/models';

/**
 * GET /api/tempmail
 * Examples:
 *  - /api/tempmail (generates a new unique inbox)
 *  - /api/tempmail?inbox=user@mailu.site&timeout=30 (fetches OTP)
 */
export async function GET(request) {
    try {
        const { searchParams } = new URL(request.url);
        const inbox = searchParams.get('inbox');
        const timeout = parseInt(searchParams.get('timeout') || '30', 10);
        const apiKey = searchParams.get('api_key') || searchParams.get('apiKey');

        if (inbox) {
            // Fetch OTP for specified inbox
            const result = await fetchRawOtp(inbox, timeout, apiKey);
            if (result.success) {
                await createLog({
                    type: 'TEMPMAIL_OTP_RECEIVED',
                    message: `OTP retrieved for ${inbox}: ${result.otp}`,
                    metadata: { inbox, otp: result.otp }
                }).catch(() => {});
            }
            return NextResponse.json(result);
        }

        // Otherwise generate a new disposable email address
        const prefix = searchParams.get('prefix') || '';
        const domain = searchParams.get('domain') || process.env.MAILU_DOMAIN || 'mailu.site';
        const newMail = generateTempEmail(prefix, domain);

        await createLog({
            type: 'TEMPMAIL_GENERATED',
            message: `New temporary inbox created: ${newMail.inbox}`,
            metadata: { inbox: newMail.inbox }
        }).catch(() => {});

        return NextResponse.json({
            success: true,
            inbox: newMail.inbox,
            username: newMail.username,
            domain: newMail.domain,
            createdAt: newMail.createdAt
        });
    } catch (err) {
        console.error('GET /api/tempmail error:', err.message);
        return NextResponse.json({ success: false, error: err.message }, { status: 500 });
    }
}

/**
 * POST /api/tempmail
 * Request Body:
 *  - { action: "generate", prefix: "rly_", domain: "mailu.site" }
 *  - { action: "get_otp", inbox: "target@mailu.site", timeout: 30, apiKey: "..." }
 */
export async function POST(request) {
    try {
        const body = await request.json().catch(() => ({}));
        const { action = 'generate', inbox, timeout = 30, apiKey, prefix = 'rly_', domain } = body;

        if (action === 'get_otp' || inbox) {
            if (!inbox) {
                return NextResponse.json({ success: false, error: 'inbox is required to fetch OTP' }, { status: 400 });
            }
            const otpResult = await fetchRawOtp(inbox, timeout, apiKey);
            return NextResponse.json(otpResult);
        }

        // Generate action
        const generated = generateTempEmail(prefix, domain);
        return NextResponse.json({
            success: true,
            inbox: generated.inbox,
            username: generated.username,
            domain: generated.domain,
            createdAt: generated.createdAt
        });
    } catch (err) {
        console.error('POST /api/tempmail error:', err.message);
        return NextResponse.json({ success: false, error: err.message }, { status: 500 });
    }
}
