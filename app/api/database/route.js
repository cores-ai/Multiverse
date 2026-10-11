import { NextResponse } from 'next/server';
import { 
    getDatabaseAccounts, 
    createDatabaseAccount, 
    deleteDatabaseAccount, 
    getDatabaseAccountDecrypted,
    createLog 
} from '@/lib/models';

export async function GET(request) {
    try {
        const { searchParams } = new URL(request.url);
        const reveal = searchParams.get('reveal') === 'true';
        const dbId = searchParams.get('dbId');

        if (reveal && dbId) {
            const decrypted = await getDatabaseAccountDecrypted(dbId);
            if (!decrypted) {
                return NextResponse.json({ success: false, error: 'Database node not found' }, { status: 404 });
            }
            return NextResponse.json({ success: true, account: decrypted });
        }

        const databaseAccounts = await getDatabaseAccounts();
        return NextResponse.json({ success: true, databaseAccounts });
    } catch (e) {
        return NextResponse.json({ success: false, error: e.message }, { status: 500 });
    }
}

export async function POST(request) {
    try {
        const body = await request.json();
        const { clusterName, dbName, dbType, host, connectionString, latencyMs } = body;

        const newDb = await createDatabaseAccount({
            clusterName: clusterName || 'shared-fleet-cluster',
            dbName,
            dbType,
            host,
            connectionString,
            latencyMs
        });

        await createLog({
            type: 'DATABASE_ADDED',
            message: `Database connection registered: '${newDb.dbName}' (${newDb.dbType}) for cluster '${newDb.clusterName}'`,
            metadata: { dbId: newDb.dbId, clusterName: newDb.clusterName }
        });

        return NextResponse.json({ success: true, databaseAccount: newDb });
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

        await deleteDatabaseAccount(dbId);
        await createLog({
            type: 'DATABASE_DELETED',
            message: `Database node removed: ${dbId}`,
            metadata: { dbId }
        });

        return NextResponse.json({ success: true, deleted: dbId });
    } catch (e) {
        return NextResponse.json({ success: false, error: e.message }, { status: 500 });
    }
}
