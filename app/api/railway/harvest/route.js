import { NextResponse } from 'next/server';
import { generateTempEmail } from '@/lib/tempmail';
import { createAccount, createLog } from '@/lib/models';
import { spawn } from 'child_process';
import path from 'path';

import fs from 'fs';

import { saveD1RailwayAccount, queryD1 } from '@/lib/d1';

/**
 * POST /api/railway/harvest
 * Triggers the Railway Playwright account harvesting script
 * and instantly provisions a verified Mailu.site tempmail for the train fleet.
 */
export async function POST(request) {
    try {
        const body = await request.json().catch(() => ({}));
        const clusterName = body.clusterName || 'railway-worker-engine';
        const targetRepoName = body.repoName || null;

        // 1. Resolve email: re-use existing provided email or generate a fresh clean disposable email
        let tempEmail = body.email || (body.clusterName && body.clusterName.includes('@') ? body.clusterName : null);
        if (!tempEmail) {
            const newMail = generateTempEmail();
            const [u, d] = newMail.inbox.split('@');
            tempEmail = `${(u || '').replace(/[_.]/g, '')}@${d || 'mailu.site'}`;
        }

        // 2. We do NOT create premature account cards here!
        // The account and its database card will ONLY be created once Railway account is fully created,
        // verified, and its verified token is saved to the database linked to the repository.
        await createLog({
            type: 'RAILWAY_SCRIPT_TRIGGERED',
            message: `Railway harvest worker triggered for mail: ${tempEmail} (${clusterName})`,
            metadata: { email: tempEmail, targetRepo: targetRepoName }
        }).catch(() => {});

        // 3. Spawn background execution of the actual Railway Playwright harvester
        try {
            const rilwayDir = ['Rilway', 'Server'].join(' ');
            const workerFile = ['account', 'worker.js'].join('_');
            
            const desktopBase = process.env.USERPROFILE ? path.join(process.env.USERPROFILE, 'Desktop') : 'C:\\Users\\iq4u8\\Desktop';
            const candidatePaths = [
                path.resolve(process.cwd(), 'auto_railway_daemon.js'),
                path.join(desktopBase, 'Multiverse', 'auto_railway_daemon.js'),
                path.resolve(process.cwd(), 'account_worker.js'),
                path.join(process.cwd(), 'account_worker.js'),
                path.join(desktopBase, 'Multiverse', 'account_worker.js'),
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
            status: 'HARVEST_INITIATED',
            email: tempEmail,
            clusterName,
            targetRepo: targetRepoName,
            timestamp: new Date().toISOString()
        });
    } catch (err) {
        console.error('POST /api/railway/harvest error:', err.message);
        return NextResponse.json({ success: false, error: err.message }, { status: 500 });
    }
}
