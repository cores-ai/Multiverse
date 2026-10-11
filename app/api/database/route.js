import { NextResponse } from 'next/server';
import { 
    getD1DatabaseAccounts, 
    saveD1DatabaseAccount, 
    deleteD1DatabaseAccount,
    queryD1 
} from '@/lib/d1';
import { createLog } from '@/lib/models';

export async function GET(request) {
    try {
        const d1Accounts = await getD1DatabaseAccounts().catch(() => []);
        let mapped = (d1Accounts || []).map(a => ({
            dbId: a.db_id,
            accountId: a.db_id,
            clusterName: a.cluster_name,
            dbName: a.db_name,
            dbType: a.db_type,
            host: a.host,
            status: (a.status || 'active').toLowerCase(),
            latencyMs: a.latency_ms || 35,
            storageUsedGb: a.storage_used_gb || 0.1,
            createdAt: a.created_at
        }));

        // Dynamic auto-sync: ensure any repo in Cloudflare D1 with stored envs has its DB node
        try {
            const repoEnvsRows = await queryD1('SELECT DISTINCT repo_name FROM repo_envs;');
            const existingClusters = new Set(mapped.map(m => (m.clusterName || '').toLowerCase()));

            for (const row of (repoEnvsRows || [])) {
                const rName = row.repo_name;
                if (rName && !existingClusters.has(rName.toLowerCase())) {
                    const dbId = `db_${rName}`;
                    const dbName = `${rName}_db`;

                    // Check for URI in envs
                    const envRows = await queryD1('SELECT env_key, env_value FROM repo_envs WHERE repo_name = ?;', [rName]).catch(() => []);
                    let dbType = 'Cloudflare D1 Vault (Encrypted ENV)';
                    let dbHost = 'mesh.d1.cloudflare.com';
                    let connStr = `d1://database.internal/${rName}_db`;

                    for (const env of envRows) {
                        if (/mongo/i.test(env.env_key)) {
                            dbType = 'MongoDB (Atlas)';
                            connStr = env.env_value;
                            try {
                                const parsed = new URL(connStr.replace('mongodb+srv://', 'http://').replace('mongodb://', 'http://'));
                                if (parsed.hostname) dbHost = parsed.hostname;
                            } catch (e) {}
                            break;
                        } else if (/postgres/i.test(env.env_key) || /database_url/i.test(env.env_key)) {
                            dbType = 'PostgreSQL (Neon)';
                            connStr = env.env_value;
                            try {
                                const parsed = new URL(connStr.replace('postgres://', 'http://').replace('postgresql://', 'http://'));
                                if (parsed.hostname) dbHost = parsed.hostname;
                            } catch (e) {}
                            break;
                        }
                    }

                    await saveD1DatabaseAccount({
                        db_id: dbId,
                        cluster_name: rName,
                        db_name: dbName,
                        db_type: dbType,
                        host: dbHost,
                        connection_string: connStr,
                        latency_ms: 28,
                        status: 'ACTIVE',
                        storage_used_gb: 0.1
                    }).catch(() => {});

                    mapped.push({
                        dbId,
                        accountId: dbId,
                        clusterName: rName,
                        dbName,
                        dbType,
                        host: dbHost,
                        status: 'active',
                        latencyMs: 28,
                        storageUsedGb: 0.1,
                        createdAt: new Date().toISOString()
                    });
                }
            }
        } catch (syncErr) {
            console.warn('[Database Sync Notice]:', syncErr.message);
        }

        return NextResponse.json({ success: true, databaseAccounts: mapped });
    } catch (e) {
        return NextResponse.json({ success: true, databaseAccounts: [] });
    }
}

export async function POST(request) {
    try {
        const body = await request.json();
        const { clusterName, dbName, dbType, host, connectionString, latencyMs } = body;
        const dbId = `db_${Date.now().toString(36)}_${Math.random().toString(36).substring(2, 6)}`;
        const cleanHost = host || `db-${Date.now().toString(36)}.mesh.internal`;

        await saveD1DatabaseAccount({
            db_id: dbId,
            cluster_name: clusterName || 'shared-fleet-cluster',
            db_name: dbName || `${(clusterName || 'cluster').replace(/-/g, '_')}_db`,
            db_type: dbType || 'PostgreSQL (Neon)',
            host: cleanHost,
            connection_string: connectionString || `postgresql://db_user:vault_pw_${Date.now()}@${cleanHost}/app_db?sslmode=require`,
            latency_ms: latencyMs || 35,
            status: 'ACTIVE',
            storage_used_gb: 0.1
        });

        await createLog({
            type: 'DATABASE_ADDED',
            message: `Database connection registered in D1: '${dbName}' (${dbType || 'PostgreSQL'}) for cluster '${clusterName}'`,
            metadata: { dbId, clusterName }
        }).catch(() => {});

        return NextResponse.json({ 
            success: true, 
            databaseAccount: {
                dbId,
                clusterName: clusterName || 'shared-fleet-cluster',
                dbName: dbName || `${(clusterName || 'cluster').replace(/-/g, '_')}_db`,
                dbType: dbType || 'PostgreSQL (Neon)',
                host: cleanHost,
                status: 'active',
                latencyMs: 35
            } 
        });
    } catch (e) {
        return NextResponse.json({ success: false, error: e.message }, { status: 500 });
    }
}

export async function DELETE(request) {
    try {
        const { searchParams } = new URL(request.url);
        const dbId = searchParams.get('dbId');

        if (!dbId) {
            return NextResponse.json({ success: false, error: 'dbId is required' }, { status: 400 });
        }

        await deleteD1DatabaseAccount(dbId);
        await createLog({
            type: 'DATABASE_DELETED',
            message: `Database node removed from D1: ${dbId}`,
            metadata: { dbId }
        }).catch(() => {});

        return NextResponse.json({ success: true, deleted: dbId });
    } catch (e) {
        return NextResponse.json({ success: false, error: e.message }, { status: 500 });
    }
}
