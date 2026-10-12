/**
 * Cloudflare D1 Database REST Client & State Synchronizer
 * Directly communicates with Cloudflare D1 REST API over edge network.
 */

export async function queryD1(sql, params = []) {
    const accountId = process.env.CLOUDFLARE_ACCOUNT_ID;
    const databaseId = process.env.CLOUDFLARE_D1_DATABASE_ID;
    const apiToken = process.env.CLOUDFLARE_API_TOKEN;

    if (!accountId || !databaseId || !apiToken) {
        console.warn('⚠️ [Cloudflare D1 Warning] Missing Cloudflare credentials in process.env');
        return [];
    }

    const url = `https://api.cloudflare.com/client/v4/accounts/${accountId}/d1/database/${databaseId}/query`;
    const res = await fetch(url, {
        method: 'POST',
        headers: {
            'Authorization': `Bearer ${apiToken}`,
            'Content-Type': 'application/json'
        },
        body: JSON.stringify({ sql, params }),
        cache: 'no-store'
    });

    const data = await res.json();
    if (!data.success) {
        throw new Error(`Cloudflare D1 Error: ${JSON.stringify(data.errors || data.messages)}`);
    }

    return data.result?.[0]?.results || [];
}

// ----------------------------------------------------
// REMOTE CONFIG (GITHUB_TOKEN, WEBHOOK_SECRET, ETC.)
// ----------------------------------------------------

export async function getRemoteConfig(key) {
    const rows = await queryD1('SELECT value FROM remote_config WHERE key = ? LIMIT 1;', [key]);
    return rows.length > 0 ? rows[0].value : null;
}

export async function setRemoteConfig(key, value) {
    return await queryD1(
        `INSERT INTO remote_config (key, value, updated_at) 
         VALUES (?, ?, CURRENT_TIMESTAMP)
         ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = CURRENT_TIMESTAMP;`,
        [key, String(value)]
    );
}

// ----------------------------------------------------
// RAILWAY ACCOUNTS (FLEET NODES)
// ----------------------------------------------------

export async function getD1RailwayAccounts() {
    return await queryD1('SELECT * FROM railway_accounts ORDER BY created_at ASC;');
}

export async function saveD1RailwayAccount({
    account_id,
    email,
    api_token,
    status = 'ACTIVE',
    credits_remaining = 5.0,
    days_left = 30,
    repos_count = 0,
    max_capacity = 2
}) {
    return await queryD1(
        `INSERT INTO railway_accounts 
         (account_id, email, api_token, status, credits_remaining, days_left, repos_count, max_capacity, created_at, last_sync_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
         ON CONFLICT(account_id) DO UPDATE SET 
            email = excluded.email,
            api_token = excluded.api_token,
            status = excluded.status,
            credits_remaining = excluded.credits_remaining,
            days_left = excluded.days_left,
            repos_count = excluded.repos_count,
            last_sync_at = CURRENT_TIMESTAMP;`,
        [account_id, email, api_token, status, Number(credits_remaining), Number(days_left), Number(repos_count), Number(max_capacity)]
    );
}

export async function deleteD1RailwayAccount(accountId) {
    await queryD1('DELETE FROM repo_deployments WHERE account_id = ?;', [accountId]);
    return await queryD1('DELETE FROM railway_accounts WHERE account_id = ?;', [accountId]);
}

// ----------------------------------------------------
// REPO DEPLOYMENTS & REAL-TIME REPO ENVS
// ----------------------------------------------------

export async function getD1RepoDeployments() {
    return await queryD1('SELECT * FROM repo_deployments ORDER BY created_at ASC;');
}

export async function saveD1RepoDeployment({
    repo_name,
    account_id = null,
    railway_project_id = null,
    railway_service_id = null,
    deployment_status = 'PENDING',
    live_url = null
}) {
    return await queryD1(
        `INSERT INTO repo_deployments 
         (repo_name, account_id, railway_project_id, railway_service_id, deployment_status, live_url, created_at)
         VALUES (?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
         ON CONFLICT(repo_name) DO UPDATE SET
            account_id = excluded.account_id,
            railway_project_id = excluded.railway_project_id,
            railway_service_id = excluded.railway_service_id,
            deployment_status = excluded.deployment_status,
            live_url = excluded.live_url;`,
        [repo_name, account_id, railway_project_id, railway_service_id, deployment_status, live_url]
    );
}

export async function getD1RepoEnvs(repoName) {
    const rows = await queryD1('SELECT env_key, env_value FROM repo_envs WHERE repo_name = ?;', [repoName]);
    const envObj = {};
    for (const r of rows) {
        envObj[r.env_key] = r.env_value;
    }
    return envObj;
}

export async function saveD1RepoEnvs(repoName, envsMap) {
    for (const [key, val] of Object.entries(envsMap)) {
        await queryD1(
            `INSERT INTO repo_envs (repo_name, env_key, env_value, updated_at)
             VALUES (?, ?, ?, CURRENT_TIMESTAMP)
             ON CONFLICT(repo_name, env_key) DO UPDATE SET env_value = excluded.env_value, updated_at = CURRENT_TIMESTAMP;`,
            [repoName, key, String(val)]
        );
    }
    return true;
}

// ----------------------------------------------------
// DATABASE ACCOUNTS (CLOUDFLARE D1 PERSISTENT MESH)
// ----------------------------------------------------

export async function getD1DatabaseAccounts() {
    return await queryD1('SELECT * FROM database_accounts ORDER BY created_at ASC;');
}

export async function saveD1DatabaseAccount({
    db_id,
    cluster_name,
    db_name,
    db_type = 'PostgreSQL (Neon)',
    host,
    connection_string,
    latency_ms = 35,
    status = 'ACTIVE',
    storage_used_gb = 0.1
}) {
    return await queryD1(
        `INSERT INTO database_accounts 
         (db_id, cluster_name, db_name, db_type, host, connection_string, latency_ms, status, storage_used_gb, created_at, last_synced_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
         ON CONFLICT(db_id) DO UPDATE SET
            cluster_name = excluded.cluster_name,
            db_name = excluded.db_name,
            db_type = excluded.db_type,
            host = excluded.host,
            connection_string = excluded.connection_string,
            latency_ms = excluded.latency_ms,
            status = excluded.status,
            storage_used_gb = excluded.storage_used_gb,
            last_synced_at = CURRENT_TIMESTAMP;`,
        [db_id, cluster_name, db_name, db_type, host, connection_string, latency_ms, status, storage_used_gb]
    );
}

export async function deleteD1DatabaseAccount(dbId) {
    return await queryD1('DELETE FROM database_accounts WHERE db_id = ?;', [dbId]);
}
