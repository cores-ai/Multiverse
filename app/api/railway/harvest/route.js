import { NextResponse } from 'next/server';
import { generateTempEmail } from '@/lib/tempmail';
import { saveD1RailwayAccount, saveD1RepoDeployment } from '@/lib/d1';
import { createAccount, createLog } from '@/lib/models';
import { spawn } from 'child_process';
import path from 'path';

/**
 * POST /api/railway/harvest
 * Orchestrates the JIT Cluster Generation Pipeline:
 * Step 1: Clean tempmail generation (Mailu API, 0 _, 0 .).
 * Step 2 (after 2s delay): Launch Playwright Railway Account Creation (HEADLESS=false for visual monitoring).
 * Step 3: Fetch OTP from Mailu API and verify account.
 * Step 4: Harvest API token.
 * Step 5: Render new Cluster Card on Middleman UI and store complete state in Cloudflare D1.
 */
export async function POST(request) {
    try {
        const body = await request.json().catch(() => ({}));
        const clusterName = body.clusterName || 'railway-cluster';

        // Step 1: Clean tempmail generation
        const newMail = generateTempEmail();
        const [u, d] = newMail.inbox.split('@');
        const tempEmail = `${(u || '').replace(/[_.]/g, '')}@${d || 'mailu.site'}`;

        // 2-Second intentional pacing delay before initiating browser worker
        await new Promise(r => setTimeout(r, 2000));

        // DO NOT pre-create dummy card in D1! 
        // Card will ONLY be created when Playwright harvests the actual Railway token and calls /api/webhooks/account-ready
        console.log(`[JIT Pipeline] Harvest initiated for: ${tempEmail}. Waiting for live Railway verification...`);
        await createLog({
            type: 'CLUSTER_GENERATION_INITIATED',
            message: `JIT Cluster pipeline triggered for ${tempEmail} (${clusterName})`,
            metadata: { email: tempEmail, clusterName }
        }).catch(() => {});

        // Step 2 & 3: Spawn Playwright Worker with HEADLESS=false
        try {
            const possibleDirs = [
                path.resolve(process.cwd(), 'railway-worker'),
                path.resolve(process.cwd(), '..', 'railway-worker'),
                path.resolve(process.cwd(), '..', 'Rilway Server')
            ];
            
            let workerDir = null;
            let workerScript = null;
            const fs = await import('fs');

            for (const d of possibleDirs) {
                const s = path.join(d, 'account_worker.js');
                if (fs.existsSync(s)) {
                    workerDir = d;
                    workerScript = s;
                    break;
                }
            }

            if (workerScript) {
                const workerProcess = spawn(process.execPath, [workerScript], {
                    cwd: workerDir,
                    detached: true,
                    stdio: 'ignore',
                    env: {
                        ...process.env,
                        TARGET_EMAIL: tempEmail,
                        HEADLESS: 'false', // Visual debugging window for the user
                        MIDDLEMAN_WEBHOOK_URL: `${process.env.NEXT_PUBLIC_BASE_URL || 'http://localhost:3000'}/api/webhooks/account-ready`,
                        WEBHOOK_SECRET: 'mega-server-jit-worker-secret-2026'
                    }
                });
                workerProcess.unref();
                console.log(`🚀 [JIT Cluster Pipeline] Spawned Playwright Worker (PID: ${workerProcess.pid}, HEADLESS: false)`);
            }
        } catch (spawnErr) {
            console.warn('⚠️ [JIT Worker] Background spawn notice:', spawnErr.message);
        }

        return NextResponse.json({
            success: true,
            email: tempEmail,
            clusterName,
            status: 'INITIALIZING',
            message: 'Harvest worker launched. Card will be created in D1 once verified.',
            timestamp: new Date().toISOString()
        });
    } catch (err) {
        console.error('POST /api/railway/harvest error:', err.message);
        return NextResponse.json({ success: false, error: err.message }, { status: 500 });
    }
}
