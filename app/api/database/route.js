import { NextResponse } from 'next/server';
import { 
    getD1DatabaseAccounts, 
    saveD1DatabaseAccount, 
    deleteD1DatabaseAccount 
} from '@/lib/d1';
import { createLog } from '@/lib/models';

export async function GET(request) {
    try {
        const d1Accounts = await getD1DatabaseAccounts().catch(() => []);
        const mapped = (d1Accounts || []).map(a => ({
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
