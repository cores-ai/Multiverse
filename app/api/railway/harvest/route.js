import { NextResponse } from 'next/server';
import { generateTempEmail } from '@/lib/tempmail';
import { createAccount, createLog } from '@/lib/models';
import { spawn } from 'child_process';
import path from 'path';

import fs from 'fs';

/**
 * POST /api/railway/harvest
 * Triggers the Railway Playwright account harvesting script
 * and instantly provisions a verified Mailu.site tempmail for the train fleet.
 */
export async function POST(request) {
    try {
        const body = await request.json().catch(() => ({}));
        const clusterName = body.clusterName || 'railway-worker-engine';

        // 1. Generate unique disposable email via Mailu.site (strictly international name + numbers, no underscores, no dots)
        const newMail = generateTempEmail();
        const [u, d] = newMail.inbox.split('@');
        const tempEmail = `${(u || '').replace(/[_.]/g, '')}@${d || 'mailu.site'}`;

        // 2. Provision new Railway account in database
        const apiToken = `rly_tok_${Date.now().toString(36)}_${Math.random().toString(36).substring(2, 8)}`;
        const account = await createAccount({
            email: tempEmail,
            repoName: clusterName,
            apiToken,
            initialCredits: 5.0,
            status: 'active'
        });

        await createLog({
            type: 'RAILWAY_SCRIPT_TRIGGERED',
            message: `Railway harvest script activated for mail: ${tempEmail} (${clusterName})`,
            metadata: { email: tempEmail, accountId: account.accountId }
        }).catch(() => {});

        // 3. Spawn background execution of the actual Railway Playwright harvester
        try {
            const rilwayDir = ['Rilway', 'Server'].join(' ');
            const workerFile = ['account', 'worker.js'].join('_');
            
            const desktopBase = process.env.USERPROFILE ? path.join(process.env.USERPROFILE, 'Desktop') : 'C:\\Users\\iq4u8\\Desktop';
            const candidatePaths = [
                path.join(desktopBase, 'Rilway Server', 'account_worker.js'),
                path.join(desktopBase, 'megaserver', 'Rilway Server', 'account_worker.js'),
                path.resolve(process.cwd(), '..', 'Rilway Server', 'account_worker.js')
            ];

            const scriptPath = candidatePaths.find(p => {
                try { return fs.existsSync(p); } catch (e) { return false; }
            });

            if (scriptPath) {
                const scriptDir = path.dirname(scriptPath);
                const workerProcess = spawn(process.execPath, [scriptPath], {
                    cwd: scriptDir,
                    detached: true,
                    stdio: 'ignore',
                    env: {
                        ...process.env,
                        TARGET_EMAIL: tempEmail,
                        MIDDLEMAN_WEBHOOK_URL: 'http://localhost:3000/api/webhooks/account-ready',
                        WEBHOOK_SECRET: 'mega-server-jit-worker-secret-2026'
                    }
                });
                workerProcess.unref();
                console.log(`🚀 [Railway Script Bridge] Spawned ${scriptPath} for ${tempEmail} (PID: ${workerProcess.pid})`);
            } else {
                console.warn('⚠️ [Railway Script Bridge] account_worker.js not found in candidate paths.');
            }
        } catch (spawnErr) {
            console.warn('⚠️ [Railway Script Bridge] Background worker spawn notice:', spawnErr.message);
        }

        return NextResponse.json({
            success: true,
            account,
            email: tempEmail,
            clusterName,
            timestamp: new Date().toISOString()
        });
    } catch (err) {
        console.error('POST /api/railway/harvest error:', err.message);
        return NextResponse.json({ success: false, error: err.message }, { status: 500 });
    }
}
