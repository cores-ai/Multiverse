import { NextResponse } from 'next/server';
import { 
    getStorageAccounts, 
    createStorageAccount, 
    deleteStorageAccount, 
    getStorageAccountDecrypted,
    createLog 
} from '@/lib/models';

export async function GET(request) {
    try {
        const { searchParams } = new URL(request.url);
        const reveal = searchParams.get('reveal') === 'true';
        const storageId = searchParams.get('storageId');

        if (reveal && storageId) {
            const decrypted = await getStorageAccountDecrypted(storageId);
            if (!decrypted) {
                return NextResponse.json({ success: false, error: 'Storage bucket not found' }, { status: 404 });
            }
            return NextResponse.json({ success: true, account: decrypted });
        }

        const storageAccounts = await getStorageAccounts();
        return NextResponse.json({ success: true, storageAccounts });
    } catch (e) {
        return NextResponse.json({ success: false, error: e.message }, { status: 500 });
    }
}

export async function POST(request) {
    try {
        const body = await request.json();
        const { clusterName, bucketName, cfAccountId, accessKeyId, secretAccessKey, endpoint, publicUrl } = body;

        const newStorage = await createStorageAccount({
            clusterName: clusterName || 'shared-fleet-cluster',
            bucketName,
            cfAccountId,
            accessKeyId,
            secretAccessKey,
            endpoint,
            publicUrl
        });

        await createLog({
            type: 'STORAGE_ADDED',
            message: `Cloudflare R2 vault configured: '${newStorage.bucketName}' for cluster '${newStorage.clusterName}'`,
            metadata: { storageId: newStorage.storageId, clusterName: newStorage.clusterName }
        });

        return NextResponse.json({ success: true, storageAccount: newStorage });
    } catch (e) {
        return NextResponse.json({ success: false, error: e.message }, { status: 500 });
    }
}

export async function DELETE(request) {
    try {
        const { searchParams } = new URL(request.url);
        const storageId = searchParams.get('storageId');

        if (!storageId) {
            return NextResponse.json({ success: false, error: 'storageId is required' }, { status: 400 });
        }

        await deleteStorageAccount(storageId);
        await createLog({
            type: 'STORAGE_DELETED',
            message: `Cloudflare R2 vault removed: ${storageId}`,
            metadata: { storageId }
        });

        return NextResponse.json({ success: true, deleted: storageId });
    } catch (e) {
        return NextResponse.json({ success: false, error: e.message }, { status: 500 });
    }
}
