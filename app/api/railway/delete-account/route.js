import { NextResponse } from 'next/server';
import { spawn } from 'child_process';
import path from 'path';
import { queryD1 } from '@/lib/d1';
import { deleteAccount, createLog } from '@/lib/models';

export async function POST(request) {
    try {
        const body = await request.json().catch(() => ({}));
        const email = body.email;
        const accountId = body.accountId;

        if (!email && !accountId) {
            return NextResponse.json({ success: false, error: 'email or accountId is required' }, { status: 400 });
        }

        // Resolve email if only accountId provided
        let targetEmail = email;
        if (!targetEmail && accountId) {
            try {
                const acc = await queryD1('SELECT email FROM railway_accounts WHERE account_id = ? LIMIT 1;', [accountId]);
                if (acc && acc[0]) targetEmail = acc[0].email;
            } catch (e) {}
        }

        if (!targetEmail) {
            return NextResponse.json({ success: false, error: 'Could not resolve account email for deletion.' }, { status: 400 });
        }

        console.log(`🗑️ [Delete Route] Initiating autonomous Railway deletion for: ${targetEmail}...`);

        // Execute delete_worker.js via child_process to delete the real Railway account
        const scriptPath = path.resolve(process.cwd(), 'delete_worker.js');
        
        const deletePromise = new Promise((resolve, reject) => {
            const proc = spawn(process.execPath, [scriptPath, targetEmail], {
                cwd: process.cwd(),
                env: {
                    ...process.env,
                    TARGET_EMAIL: targetEmail,
                    HEADLESS: 'true'
                }
            });

            let output = '';
            proc.stdout.on('data', d => {
                output += d.toString();
                console.log(`[Delete Worker]: ${d.toString().trim()}`);
            });
            proc.stderr.on('data', d => {
                output += d.toString();
                console.warn(`[Delete Worker Err]: ${d.toString().trim()}`);
            });

            proc.on('close', code => {
                if (code === 0 || output.includes('Railway account successfully deleted') || output.includes('permanent account deletion')) {
                    resolve({ success: true, output });
                } else {
                    resolve({ success: false, output, code });
                }
            });

            proc.on('error', err => {
                reject(err);
            });

            // Set timeout of 60 seconds
            setTimeout(() => {
                proc.kill();
                resolve({ success: false, output: output + ' (Process timed out after 60s)' });
            }, 60000);
        });

        const deleteResult = await deletePromise;

        // If deletion completed (or test mode passed)
        if (deleteResult.success) {
            console.log(`✅ [Delete Route] Railway account deleted! Waiting 2 seconds before removing cluster node...`);
            
            // As instructed: Wait 2 seconds after Railway account deletion before removing cluster node
            await new Promise(r => setTimeout(r, 2000));

            // Clean up from Cloudflare D1
            try {
                await queryD1('UPDATE repo_deployments SET account_id = NULL, deployment_status = \'NOT_DEPLOYED\' WHERE account_id = ? OR repo_name = ?;', [accountId, targetEmail]);
                await queryD1('DELETE FROM railway_accounts WHERE email = ? OR account_id = ?;', [targetEmail, accountId]);
            } catch (d1Err) {
                console.warn('[D1 Deletion cleanup notice]:', d1Err.message);
            }

            // Clean up from MongoDB / models
            if (accountId) {
                await deleteAccount(accountId).catch(() => {});
            }

            await createLog({
                type: 'RAILWAY_ACCOUNT_PERMANENTLY_DELETED',
                message: `Railway account and cluster node destroyed: ${targetEmail}`,
                metadata: { email: targetEmail, accountId }
            }).catch(() => {});

            return NextResponse.json({
                success: true,
                message: `Railway account ${targetEmail} permanently deleted, and cluster node removed after 2s.`,
                deletedEmail: targetEmail
            });
        } else {
            console.warn(`⚠️ [Delete Route] Deletion script finished with notice: ${deleteResult.output.substring(0, 150)}`);
            return NextResponse.json({
                success: false,
                error: 'Railway deletion could not be verified automatically yet.',
                details: deleteResult.output.substring(0, 300)
            }, { status: 500 });
        }

    } catch (err) {
        console.error('POST /api/railway/delete-account error:', err.message);
        return NextResponse.json({ success: false, error: err.message }, { status: 500 });
    }
}
