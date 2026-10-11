import { getDatabase } from './mongodb';
import { encryptData, decryptData } from './crypto';

// ----------------------------------------------------
// 1. ACCOUNTS REPOSITORY (Railway Accounts Fleet)
// ----------------------------------------------------

export async function getAccounts() {
    const db = await getDatabase();
    const accounts = await db.collection('accounts').find({}).sort({ createdAt: 1 }).toArray();
    return accounts.map(acc => ({
        ...acc,
        _id: acc._id.toString(),
        // Keep decrypted token server-side only when explicitly requested
        apiToken: acc.apiTokenEncrypted ? decryptData(acc.apiTokenEncrypted) : null,
        apiTokenMasked: acc.apiTokenEncrypted ? maskToken(decryptData(acc.apiTokenEncrypted)) : 'None'
    }));
}

export async function getActiveAccounts() {
    const db = await getDatabase();
    const accounts = await db.collection('accounts').find({
        status: { $in: ['active', 'standby'] },
        remainingCredits: { $gt: 2.0 }
    }).sort({ createdAt: 1 }).toArray();
    return accounts.map(acc => ({
        ...acc,
        _id: acc._id.toString(),
        apiToken: decryptData(acc.apiTokenEncrypted)
    }));
}

export async function createAccount({ email, repoName, apiToken, initialCredits = 5.0, status = 'active' }) {
    const db = await getDatabase();
    const newAccount = {
        accountId: `rly_${Date.now().toString(36)}_${Math.random().toString(36).substring(2, 6)}`,
        email: email || `auto_${Date.now()}@domain.local`,
        repoName: repoName || null,
        apiTokenEncrypted: encryptData(apiToken),
        activeProjectsCount: 0,
        maxCapacity: 2,
        remainingCredits: Number(initialCredits),
        currency: 'USD',
        status: status, // 'active' | 'standby' | 'migrating' | 'exhausted'
        createdAt: new Date(),
        lastSyncedAt: new Date()
    };
    const result = await db.collection('accounts').insertOne(newAccount);
    return { ...newAccount, _id: result.insertedId.toString(), apiToken };
}

export async function updateAccountCredits(accountId, remainingCredits, burnRatePerHour = 0) {
    const db = await getDatabase();
    const update = {
        $set: {
            remainingCredits: Number(remainingCredits),
            burnRatePerHour: Number(burnRatePerHour),
            lastSyncedAt: new Date()
        }
    };
    // If credit falls below or equal to 2.00, tag as low_credit
    if (Number(remainingCredits) <= 2.0) {
        update.$set.status = 'low_credit';
    }
    await db.collection('accounts').updateOne({ accountId }, update);
}

export async function updateAccountProjectsCount(accountId, delta) {
    const db = await getDatabase();
    await db.collection('accounts').updateOne(
        { accountId },
        { 
            $inc: { activeProjectsCount: delta },
            $set: { lastSyncedAt: new Date() }
        }
    );
}

export async function deleteAccount(accountId) {
    const db = await getDatabase();
    let res = await db.collection('accounts').deleteOne({ accountId });
    if (!res || res.deletedCount === 0) {
        res = await db.collection('accounts').deleteOne({ _id: accountId });
    }
    return res;
}

// ----------------------------------------------------
// 2. REPOSITORIES COLLECTION (Hosted Fleet)
// ----------------------------------------------------

export async function getRepositories() {
    const db = await getDatabase();
    const repos = await db.collection('repositories').find({}).sort({ createdAt: 1 }).toArray();
    return repos.map(r => ({ ...r, _id: r._id.toString() }));
}

export async function getRepositoryById(repoId) {
    const db = await getDatabase();
    const repo = await db.collection('repositories').findOne({ repoId });
    if (!repo) return null;
    return { ...repo, _id: repo._id.toString() };
}

export async function saveRepository(repoData) {
    const db = await getDatabase();
    const repo = {
        repoId: repoData.repoId || `repo_${Date.now().toString(36)}`,
        repoName: repoData.repoName,
        githubUrl: repoData.githubUrl,
        branch: repoData.branch || 'main',
        serviceType: repoData.serviceType || 'HEAVY', // 'HEAVY' (Playwright) | 'LIGHT' (API)
        assignedAccountId: repoData.assignedAccountId,
        railwayProjectId: repoData.railwayProjectId || null,
        railwayServiceId: repoData.railwayServiceId || null,
        deploymentStatus: repoData.deploymentStatus || 'INITIALIZING', // 'INITIALIZING' | 'BUILDING' | 'SUCCESS' | 'FAILED'
        liveUrl: repoData.liveUrl || null,
        lastHealthPing: { status: 'UNKNOWN', latencyMs: 0, checkedAt: new Date() },
        createdAt: new Date(),
        updatedAt: new Date()
    };
    const result = await db.collection('repositories').insertOne(repo);
    return { ...repo, _id: result.insertedId.toString() };
}

export async function updateRepositoryDeployment(repoId, updates) {
    const db = await getDatabase();
    await db.collection('repositories').updateOne(
        { repoId },
        { $set: { ...updates, updatedAt: new Date() } }
    );
}

// ----------------------------------------------------
// 3. ENVIRONMENT VARIABLES (Strictly Linked & Versioned)
// ----------------------------------------------------

export async function getRepoEnvVariables(repoId) {
    const db = await getDatabase();
    const record = await db.collection('env_variables').findOne({ repoId });
    if (!record) return { repoId, version: 0, variables: {}, keys: [] };

    const decrypted = decryptData(record.encryptedVariables);
    return {
        repoId,
        version: record.version || 1,
        variables: decrypted || {},
        keys: record.variableKeys || Object.keys(decrypted || {}),
        updatedAt: record.updatedAt
    };
}

export async function saveRepoEnvVariables(repoId, variablesObj) {
    const db = await getDatabase();
    const existing = await db.collection('env_variables').findOne({ repoId });

    const newVersion = existing ? (existing.version || 1) + 1 : 1;
    const encrypted = encryptData(variablesObj);
    const keys = Object.keys(variablesObj);

    const historyEntry = {
        version: newVersion,
        keys: keys,
        savedAt: new Date()
    };

    if (existing) {
        await db.collection('env_variables').updateOne(
            { repoId },
            {
                $set: {
                    encryptedVariables: encrypted,
                    variableKeys: keys,
                    version: newVersion,
                    updatedAt: new Date()
                },
                $push: { history: historyEntry }
            }
        );
    } else {
        await db.collection('env_variables').insertOne({
            repoId,
            version: 1,
            encryptedVariables: encrypted,
            variableKeys: keys,
            history: [historyEntry],
            createdAt: new Date(),
            updatedAt: new Date()
        });
    }

    return { repoId, version: newVersion, keys };
}

// ----------------------------------------------------
// 4. AUTOMATION AUDIT LOGS
// ----------------------------------------------------

export async function createLog({ type, message, metadata = {} }) {
    try {
        const db = await getDatabase();
        await db.collection('automation_logs').insertOne({
            type, // 'JIT_ACCOUNT_CREATED' | 'DEPLOYMENT' | 'MIGRATION' | 'CREDIT_WARNING' | 'HEALTH_RESTORE'
            message,
            metadata,
            timestamp: new Date()
        });
    } catch (e) {
        console.error('Failed to write log:', e.message);
    }
}

export async function getRecentLogs(limit = 50) {
    const db = await getDatabase();
    const logs = await db.collection('automation_logs')
        .find({})
        .sort({ timestamp: -1 })
        .limit(limit)
        .toArray();
    return logs.map(l => ({ ...l, _id: l._id.toString() }));
}

function maskToken(token) {
    if (!token || typeof token !== 'string') return '****';
    if (token.length <= 8) return '****' + token.slice(-2);
    return token.slice(0, 4) + '••••••••' + token.slice(-4);
}

// ----------------------------------------------------
// 5. CLOUDFLARE R2 STORAGE (Per-Cluster Storage Vaults)
// ----------------------------------------------------

export async function getStorageAccounts() {
    const db = await getDatabase();
    const accounts = await db.collection('storage_accounts').find({}).sort({ createdAt: 1 }).toArray();
    return accounts.map(acc => {
        const decryptedSecret = acc.secretAccessKeyEncrypted ? decryptData(acc.secretAccessKeyEncrypted) : null;
        return {
            ...acc,
            _id: acc._id.toString(),
            accessKeyIdMasked: maskToken(acc.accessKeyId),
            secretAccessKeyMasked: maskToken(decryptedSecret),
            secretAccessKey: null // Kept server-side by default
        };
    });
}

export async function getStorageAccountDecrypted(storageId) {
    const db = await getDatabase();
    const acc = await db.collection('storage_accounts').findOne({ storageId });
    if (!acc) return null;
    return {
        ...acc,
        _id: acc._id.toString(),
        secretAccessKey: acc.secretAccessKeyEncrypted ? decryptData(acc.secretAccessKeyEncrypted) : null
    };
}

export async function createStorageAccount({
    clusterName,
    bucketName,
    cfAccountId = 'cf_7894a9f2bc0e1189',
    accessKeyId,
    secretAccessKey,
    endpoint,
    publicUrl,
    region = 'WNAM (Cloudflare Edge)',
    status = 'active'
}) {
    const db = await getDatabase();
    const cleanBucket = bucketName || `r2-${clusterName || 'cluster-vault'}`;
    const cleanAccountId = cfAccountId || 'cf_7894a9f2bc0e1189';
    const cleanAccessKey = accessKeyId || `cf_r2_acc_${Math.random().toString(36).substring(2, 8)}`;
    const cleanSecret = secretAccessKey || `cf_r2_sec_${Date.now().toString(36)}_${Math.random().toString(36).substring(2, 10)}`;

    const newStorage = {
        storageId: `r2_vault_${Date.now().toString(36)}_${Math.random().toString(36).substring(2, 6)}`,
        clusterName: clusterName || 'shared-fleet-cluster',
        bucketName: cleanBucket,
        provider: 'Cloudflare R2',
        cfAccountId: cleanAccountId,
        accessKeyId: cleanAccessKey,
        secretAccessKeyEncrypted: encryptData(cleanSecret),
        endpoint: endpoint || `https://${cleanAccountId}.r2.cloudflarestorage.com/${cleanBucket}`,
        publicUrl: publicUrl || `https://pub-r2.${cleanBucket}.edge.cloudflare.com`,
        storageUsedGb: 0.05,
        storageLimitGb: 10.0,
        region,
        status,
        createdAt: new Date(),
        lastSyncedAt: new Date()
    };

    const result = await db.collection('storage_accounts').insertOne(newStorage);
    return { ...newStorage, _id: result.insertedId.toString() };
}

export async function deleteStorageAccount(storageId) {
    const db = await getDatabase();
    await db.collection('storage_accounts').deleteOne({ storageId });
}

// ----------------------------------------------------
// 6. DATABASE NODES & CREDENTIAL VAULT
// ----------------------------------------------------

export async function getDatabaseAccounts() {
    const db = await getDatabase();
    const accounts = await db.collection('database_accounts').find({}).sort({ createdAt: 1 }).toArray();
    return accounts.map(acc => {
        const decryptedUri = acc.connectionStringEncrypted ? decryptData(acc.connectionStringEncrypted) : null;
        return {
            ...acc,
            _id: acc._id.toString(),
            connectionStringMasked: maskToken(decryptedUri),
            connectionString: null
        };
    });
}

export async function getDatabaseAccountDecrypted(dbId) {
    const db = await getDatabase();
    const acc = await db.collection('database_accounts').findOne({ dbId });
    if (!acc) return null;
    return {
        ...acc,
        _id: acc._id.toString(),
        connectionString: acc.connectionStringEncrypted ? decryptData(acc.connectionStringEncrypted) : null
    };
}

export async function createDatabaseAccount({
    clusterName,
    dbName,
    dbType = 'PostgreSQL (Neon)',
    host,
    connectionString,
    latencyMs = 35,
    status = 'active'
}) {
    const db = await getDatabase();
    const cleanHost = host || `db-${Date.now().toString(36)}.mesh.internal`;
    const cleanConn = connectionString || `postgresql://db_user:vault_pw_${Date.now()}@${cleanHost}/app_db?sslmode=require`;

    const newDb = {
        dbId: `db_${Date.now().toString(36)}_${Math.random().toString(36).substring(2, 6)}`,
        clusterName: clusterName || 'shared-fleet-cluster',
        dbName: dbName || `${clusterName || 'cluster'}_db`,
        dbType,
        host: cleanHost,
        connectionStringEncrypted: encryptData(cleanConn),
        status,
        storageUsedGb: 0.1,
        latencyMs,
        createdAt: new Date(),
        lastSyncedAt: new Date()
    };

    const result = await db.collection('database_accounts').insertOne(newDb);
    return { ...newDb, _id: result.insertedId.toString() };
}

export async function deleteDatabaseAccount(dbId) {
    const db = await getDatabase();
    await db.collection('database_accounts').deleteOne({ dbId });
}

