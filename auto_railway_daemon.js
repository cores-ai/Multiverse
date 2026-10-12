/**
 * Autonomous Railway Automation Daemon for Multiverse
 * Eliminates Telegram bot dependency completely.
 * Automatically provisions disposable Mailu tempmail, bypasses Cloudflare Turnstile,
 * receives OTP, auto-clears Terms of Service, harvests Railway GraphQL API token,
 * and saves the harvested token directly to Cloudflare D1 under the repo's ENVs (repo_envs: RAILWAY_TOKEN),
 * railway_accounts, and updates repo_deployments.
 */

require('dotenv').config();
const http = require('http');
const { firefox } = require('playwright');
const path = require('path');
const fs = require('fs');
const spoofConfig = require('./spoof_config');
const { generateStealthScript } = require('./stealth_injections');
const { harvestRailwayApiToken, handleRailwayTermsOfService } = require('./token_harvester');
const { generateTempEmail, fetchRawOtp } = require('./tempmail_client');

const CLOUDFLARE_ACCOUNT_ID = process.env.CLOUDFLARE_ACCOUNT_ID;
const CLOUDFLARE_D1_DATABASE_ID = process.env.CLOUDFLARE_D1_DATABASE_ID;
const CLOUDFLARE_API_TOKEN = process.env.CLOUDFLARE_API_TOKEN;

const HTTP_PORT = process.env.DAEMON_PORT || 4000;
const POLL_INTERVAL_MS = parseInt(process.env.POLL_INTERVAL_MS || '4000', 10);

let isAutomationActive = false;

// ----------------------------------------------------
// Cloudflare D1 REST Client
// ----------------------------------------------------
async function queryD1(sql, params = []) {
    if (!CLOUDFLARE_ACCOUNT_ID || !CLOUDFLARE_D1_DATABASE_ID || !CLOUDFLARE_API_TOKEN) {
        throw new Error('Cloudflare D1 credentials missing in .env');
    }
    const url = `https://api.cloudflare.com/client/v4/accounts/${CLOUDFLARE_ACCOUNT_ID}/d1/database/${CLOUDFLARE_D1_DATABASE_ID}/query`;
    const res = await fetch(url, {
        method: 'POST',
        headers: {
            'Authorization': `Bearer ${CLOUDFLARE_API_TOKEN}`,
            'Content-Type': 'application/json'
        },
        body: JSON.stringify({ sql, params })
    });
    const data = await res.json();
    if (!data.success) {
        throw new Error(`D1 Query Error: ${JSON.stringify(data.errors || data.messages)}`);
    }
    return data.result?.[0]?.results || [];
}

function clearDirectorySafe(dirPath) {
    if (!fs.existsSync(dirPath)) {
        fs.mkdirSync(dirPath, { recursive: true });
        return;
    }
    try {
        fs.rmSync(dirPath, { recursive: true, force: true });
    } catch (e) {
        try {
            const entries = fs.readdirSync(dirPath);
            for (const entry of entries) {
                try { fs.rmSync(path.join(dirPath, entry), { recursive: true, force: true }); } catch (err) {}
            }
        } catch (err) {}
    }
    if (!fs.existsSync(dirPath)) fs.mkdirSync(dirPath, { recursive: true });
}

// ----------------------------------------------------
// Core Autonomous Browser Automation Flow
// Exact proven engine from locked golden state
// ----------------------------------------------------
async function runAutonomousRailwayProvision(targetRepoName = null) {
    if (isAutomationActive) {
        console.log('? [Multiverse Daemon] Automation already in progress. Skipping duplicate run.');
        return null;
    }

    isAutomationActive = true;
    const sessionId = `auto_${Date.now()}`;
    const sessionDir = path.resolve(__dirname, 'sessions', `profile_${sessionId}`);

    if (spoofConfig.clearSessionOnEveryStart) {
        clearDirectorySafe(sessionDir);
    } else {
        if (!fs.existsSync(sessionDir)) fs.mkdirSync(sessionDir, { recursive: true });
    }

    let browserContext = null;
    try {
        // 1. Generate clean Mailu disposable email
        const generatedEmail = await generateTempEmail();
        console.log(`\n======================================================`);
        console.log(`?? [Multiverse Daemon] Starting Autonomous Railway Provisioning`);
        console.log(`?? Generated Mailu Email: ${generatedEmail}`);
        if (targetRepoName) {
            console.log(`?? Target Repository: ${targetRepoName}`);
        }
        console.log(`======================================================\n`);

        const winWidth = spoofConfig.windowSize?.width || 900;
        const winHeight = spoofConfig.windowSize?.height || 600;
        const isHeadless = process.env.HEADLESS === 'true';

        const firefoxUserPrefs = {
            'network.trr.mode': spoofConfig.dns?.enabled ? spoofConfig.dns.mode : 0,
            'network.trr.uri': spoofConfig.dns?.dohUri || 'https://dns.google/dns-query',
            'network.trr.custom_uri': spoofConfig.dns?.dohUri || 'https://dns.google/dns-query',
            'network.trr.bootstrapAddress': spoofConfig.dns?.bootstrapAddress || '8.8.8.8',
            'network.trr.send_user_agent': false,
            'network.trr.send_edns_client_subnet': false,
            'browser.sessionstore.resume_from_crash': false,
            'browser.sessionstore.enabled': false,
            'browser.sessionstore.max_resumed_crashes': 0,
            'browser.sessionstore.restore_on_demand': false,
            'browser.startup.page': 0,
            'privacy.clearOnShutdown.cache': true,
            'privacy.clearOnShutdown.cookies': true,
            'privacy.clearOnShutdown.history': true,
            'media.peerconnection.enabled': true,
            'media.peerconnection.ice.no_host': true,
            'media.peerconnection.ice.default_address_only': true,
            'media.peerconnection.ice.proxy_only': true,
            'toolkit.telemetry.enabled': false,
            'marionette.enabled': false,
            'dom.webdriver.enabled': false,
        };

        const contextOptions = {
            headless: isHeadless,
            viewport: null,
            locale: spoofConfig.locale,
            timezoneId: spoofConfig.timezoneId,
            geolocation: spoofConfig.geolocation,
            permissions: ['geolocation'],
            userAgent: spoofConfig.userAgent,
            firefoxUserPrefs: firefoxUserPrefs,
            args: ['-width', `${winWidth}`, '-height', `${winHeight}`],
        };

        console.log('?? [Multiverse Daemon] Launching Stealth Firefox context...');
        browserContext = await firefox.launchPersistentContext(sessionDir, contextOptions);
        const stealthScript = generateStealthScript(spoofConfig);
        await browserContext.addInitScript(stealthScript);

        const pages = browserContext.pages();
        const page = pages.length > 0 ? pages[0] : await browserContext.newPage();

        const targetUrl = 'https://railway.com/deploy';
        console.log(`?? [Multiverse Daemon] Navigating to ${targetUrl}...`);
        try {
            await page.goto(targetUrl, { waitUntil: 'domcontentloaded', timeout: 45000 });
        } catch (navErr) {
            console.warn('Navigation retry:', navErr.message);
            await page.goto(targetUrl, { waitUntil: 'commit', timeout: 30000 }).catch(() => {});
        }
        await page.bringToFront().catch(() => {});

        // Step 1: Click "Sign in"
        console.log('??? [Multiverse Daemon] Clicking "Sign in"...');
        await page.evaluate(async () => {
            for (let i = 0; i < 40; i++) {
                const buttons = Array.from(document.querySelectorAll('button, a'));
                const btn = buttons.find(b => {
                    const t = (b.innerText || b.textContent || '').trim().toLowerCase();
                    return t === 'sign in';
                });
                if (btn) { btn.click(); return true; }
                await new Promise(r => setTimeout(r, 500));
            }
            return false;
        }).catch(() => false);

        // Step 2: Click "Log in using email"
        console.log('??? [Multiverse Daemon] Clicking "Log in using email"...');
        await page.evaluate(async () => {
            for (let i = 0; i < 40; i++) {
                const buttons = Array.from(document.querySelectorAll('button, a'));
                const btn = buttons.find(b => {
                    const text = (b.innerText || b.textContent || '').trim().toLowerCase();
                    return text.includes('log in using email') || text.includes('login with email') || text.includes('using email');
                });
                if (btn) { btn.click(); return true; }
                await new Promise(r => setTimeout(r, 500));
            }
            return false;
        }).catch(() => false);

        // Step 3: Fill email input
        console.log(`?? [Multiverse Daemon] Filling email input with ${generatedEmail}...`);
        const emailInput = page.locator('input[type="email"], input[name="email"]').first();
        await emailInput.waitFor({ state: 'visible', timeout: 10000 });
        await emailInput.fill(generatedEmail);
        await new Promise(r => setTimeout(r, 500));

        // Verify fill
        const currentVal = await emailInput.inputValue().catch(() => '');
        if (currentVal !== generatedEmail) {
            await emailInput.evaluate((el, val) => {
                const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
                setter.call(el, val);
                el.dispatchEvent(new Event('input', { bubbles: true }));
                el.dispatchEvent(new Event('change', { bubbles: true }));
            }, generatedEmail);
            await new Promise(r => setTimeout(r, 500));
        }

        // Step 4: Cloudflare Turnstile bypass (proven coordinate click)
        console.log('??? [Multiverse Daemon] Detecting Cloudflare Turnstile box...');
        let turnstileBox = null;
        for (let attempt = 0; attempt < 30; attempt++) {
            try {
                const box = await page.evaluate(() => {
                    const input = document.querySelector('input[name="cf-turnstile-response"]');
                    if (input && input.parentElement) {
                        const rect = input.parentElement.getBoundingClientRect();
                        if (rect.width > 0 && rect.height > 0) {
                            return { x: rect.x, y: rect.y, width: rect.width, height: rect.height };
                        }
                    }
                    return null;
                }).catch(() => null);

                if (box) {
                    turnstileBox = box;
                    break;
                }
            } catch (e) {}
            await new Promise(r => setTimeout(r, 500));
        }

        if (turnstileBox) {
            console.log('? [Multiverse Daemon] Clicking Turnstile checkbox coordinates...');
            const bx = turnstileBox;
            const clickX = bx.x + 28;
            const clickY = bx.y + (bx.height / 2);
            await page.mouse.move(bx.x + bx.width / 2, bx.y - 50);
            await new Promise(r => setTimeout(r, 300));
            await page.mouse.move(clickX, clickY, { steps: 10 });
            await new Promise(r => setTimeout(r, 200));
            await page.mouse.down();
            await new Promise(r => setTimeout(r, 80 + Math.random() * 60));
            await page.mouse.up();
            await new Promise(r => setTimeout(r, 5000));

            // Retry if needed
            const isEnabled = await page.evaluate(() => {
                const btn = Array.from(document.querySelectorAll('button')).find(b =>
                    (b.innerText || '').toLowerCase().includes('continue with email'));
                return btn && !btn.disabled;
            }).catch(() => false);

            if (!isEnabled) {
                console.log('? [Multiverse Daemon] Turnstile retry coordinate click...');
                const retryX = bx.x + 26;
                const retryY = bx.y + (bx.height / 2) - 2;
                await page.mouse.move(retryX + 100, retryY + 30);
                await new Promise(r => setTimeout(r, 200));
                await page.mouse.move(retryX, retryY, { steps: 8 });
                await new Promise(r => setTimeout(r, 150));
                await page.mouse.down();
                await new Promise(r => setTimeout(r, 90 + Math.random() * 50));
                await page.mouse.up();
                await new Promise(r => setTimeout(r, 5000));
            }
        }

        // Step 5: Click "Continue with email"
        console.log('?? [Multiverse Daemon] Clicking "Continue with email"...');
        const emailSentTime = Date.now() - 3000;
        await page.evaluate(async () => {
            for (let i = 0; i < 20; i++) {
                const btn = Array.from(document.querySelectorAll('button')).find(b =>
                    (b.innerText || '').trim().toLowerCase().includes('continue with email'));
                if (btn && !btn.disabled) { btn.click(); return true; }
                await new Promise(r => setTimeout(r, 500));
            }
            return false;
        }).catch(() => false);

        // Step 6: Poll Mailu for OTP (Dual-tier Mailbox + Master KV)
        console.log(`? [Multiverse Daemon] Polling Mailu OTP for ${generatedEmail}...`);
        const rawOtp = await fetchRawOtp(generatedEmail, 45, emailSentTime);
        const cleanOtp = (rawOtp || '').match(/\d{6}/)?.[0] || (rawOtp || '').trim();

        if (!cleanOtp || !/^\d{6}$/.test(cleanOtp)) {
            throw new Error(`Failed to extract valid 6-digit OTP for ${generatedEmail}. Got: "${cleanOtp}"`);
        }
        console.log(`? [Multiverse Daemon] OTP successfully obtained: ${cleanOtp}`);

        // Step 7: Locate OTP PIN inputs and type digits
        console.log('?? [Multiverse Daemon] Typing 6-digit OTP into Railway login form...');
        let firstInput = null;
        let targetFrame = page;

        for (let attempt = 0; attempt < 60; attempt++) {
            const frames = [page, ...page.frames()];
            for (const frame of frames) {
                try {
                    if (await frame.locator('#pin-code-input-0').count() > 0) {
                        firstInput = frame.locator('#pin-code-input-0').first();
                        targetFrame = frame;
                        break;
                    }
                } catch (e) {}
            }
            if (firstInput) break;
            await new Promise(r => setTimeout(r, 500));
        }

        if (!firstInput) {
            throw new Error("Could not find OTP input field '#pin-code-input-0' in DOM.");
        }

        await firstInput.waitFor({ state: 'visible', timeout: 5000 }).catch(() => {});
        await new Promise(r => setTimeout(r, 500));
        await firstInput.click();
        await new Promise(r => setTimeout(r, 300));

        for (let i = 0; i < 6; i++) {
            const input = targetFrame.locator(`#pin-code-input-${i}`);
            await input.click();
            await new Promise(r => setTimeout(r, 80 + Math.random() * 80));
            await input.fill(cleanOtp[i]);
            await new Promise(r => setTimeout(r, 100 + Math.random() * 100));
        }

        console.log('? [Multiverse Daemon] OTP submitted. Waiting for authentication and dashboard navigation...');
        await new Promise(r => setTimeout(r, 5000));

        // Step 8: Wait for dashboard/project navigation
        for (let attempt = 0; attempt < 20; attempt++) {
            await new Promise(r => setTimeout(r, 1000));
            const currentUrl = page.url();
            if (currentUrl.includes('dashboard') || currentUrl.includes('project')) {
                break;
            }
        }

        // Step 9: Resilient Terms of Service clearing (1/2 and 2/2)
        console.log('?? [Multiverse Daemon] Auto-clearing Terms of Service modals...');
        try {
            await handleRailwayTermsOfService(page);
        } catch (e) {
            console.warn('Terms handling notice:', e.message);
        }

        // Step 10: Harvest real Railway GraphQL API Token
        const tokenName = targetRepoName ? `cluster-${targetRepoName}` : `cluster-${generatedEmail.split('@')[0]}`;
        console.log(`?? [Multiverse Daemon] Harvesting Railway GraphQL API token (${tokenName})...`);
        const tokenResult = await harvestRailwayApiToken(page, 30000, tokenName);

        if (!tokenResult || !tokenResult.token) {
            throw new Error('API token extraction returned empty or null.');
        }

        const harvestedToken = tokenResult.token;
        const accountId = `railway_${Date.now()}`;
        console.log(`\n?? [Multiverse Daemon] Harvested Railway API Token: ${harvestedToken}`);

        // Step 11: Persist token to Cloudflare D1
        console.log('?? [Multiverse Daemon] Syncing token and account to Cloudflare D1...');

        // 11a. Insert into railway_accounts table
        await queryD1(
            `INSERT INTO railway_accounts 
             (account_id, email, api_token, status, credits_remaining, days_left, repos_count, max_capacity, created_at, last_sync_at)
             VALUES (?, ?, ?, 'ACTIVE', 5.0, 30, ?, 2, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
             ON CONFLICT(account_id) DO UPDATE SET email = excluded.email, api_token = excluded.api_token;`,
            [accountId, generatedEmail, harvestedToken, targetRepoName ? 1 : 0]
        );
        console.log(`? [Multiverse Daemon] Registered account ${accountId} in railway_accounts.`);

        // 11b. If target repo provided or pending repo exists, save RAILWAY_TOKEN into repo_envs & update deployment
        let repoToAssign = targetRepoName;
        if (!repoToAssign) {
            const pendingRepos = await queryD1(
                `SELECT repo_name FROM repo_deployments 
                 WHERE (account_id IS NULL OR deployment_status = 'WAITING_JIT_ACCOUNT') 
                 ORDER BY created_at ASC LIMIT 1;`
            ).catch(() => []);
            if (pendingRepos && pendingRepos.length > 0) {
                repoToAssign = pendingRepos[0].repo_name;
            }
        }

        if (repoToAssign) {
            console.log(`🚀 [Multiverse Daemon] Executing live automated deployment on Railway for: ${repoToAssign}...`);

            try {
                // 1. Fetch environment variables from D1 repo_envs
                const envRows = await queryD1('SELECT env_key, env_value FROM repo_envs WHERE repo_name = ?;', [repoToAssign]).catch(() => []);
                const envMap = {};
                if (Array.isArray(envRows)) {
                    envRows.forEach(e => { if (e.env_key) envMap[e.env_key] = e.env_value; });
                }
                envMap['RAILWAY_TOKEN'] = harvestedToken;

                // 2. Create Railway Project
                const pRes = await fetch('https://backboard.railway.com/graphql/v2', {
                    method: 'POST',
                    headers: { 'Authorization': 'Bearer ' + harvestedToken, 'Content-Type': 'application/json' },
                    body: JSON.stringify({ query: 'mutation CreateProject($name: String!) { projectCreate(input: { name: $name }) { id name environments { edges { node { id } } } } }', variables: { name: repoToAssign } })
                });
                const pData = await pRes.json();
                const projectId = pData?.data?.projectCreate?.id;
                const environmentId = pData?.data?.projectCreate?.environments?.edges?.[0]?.node?.id;
                console.log(`✅ [Multiverse Daemon] Railway Project Created: ${projectId}`);

                // 3. Create Service linked to GitHub Repo (Coras-Multiverse/giveaway)
                const sRes = await fetch('https://backboard.railway.com/graphql/v2', {
                    method: 'POST',
                    headers: { 'Authorization': 'Bearer ' + harvestedToken, 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        query: 'mutation ServiceCreate($projectId: String!, $name: String!, $source: ServiceSourceInput) { serviceCreate(input: { projectId: $projectId, name: $name, source: $source }) { id name } }',
                        variables: { projectId, name: repoToAssign, source: { repo: 'Coras-Multiverse/' + repoToAssign } }
                    })
                });
                const sData = await sRes.json();
                const serviceId = sData?.data?.serviceCreate?.id;
                console.log(`✅ [Multiverse Daemon] Railway Service Created: ${serviceId}`);

                // 4. Inject Environment Variables
                for (const [key, val] of Object.entries(envMap)) {
                    await fetch('https://backboard.railway.com/graphql/v2', {
                        method: 'POST',
                        headers: { 'Authorization': 'Bearer ' + harvestedToken, 'Content-Type': 'application/json' },
                        body: JSON.stringify({
                            query: 'mutation VarUpsert($input: VariableUpsertInput!) { variableUpsert(input: $input) }',
                            variables: { input: { projectId, environmentId, serviceId, name: String(key), value: String(val) } }
                        })
                    }).catch(() => {});
                }
                console.log(`✅ [Multiverse Daemon] Injected ${Object.keys(envMap).length} variables into Railway service.`);

                // 5. Generate Service Domain
                let liveUrl = 'https://' + repoToAssign + '.up.railway.app';
                try {
                    const dRes = await fetch('https://backboard.railway.com/graphql/v2', {
                        method: 'POST',
                        headers: { 'Authorization': 'Bearer ' + harvestedToken, 'Content-Type': 'application/json' },
                        body: JSON.stringify({
                            query: 'mutation CreateDomain($input: ServiceDomainCreateInput!) { serviceDomainCreate(input: $input) { domain } }',
                            variables: { input: { environmentId, serviceId } }
                        })
                    });
                    const dData = await dRes.json();
                    if (dData?.data?.serviceDomainCreate?.domain) {
                        liveUrl = 'https://' + dData.data.serviceDomainCreate.domain;
                    }
                } catch (domErr) {}

                // 6. Trigger Build & Deploy
                await fetch('https://backboard.railway.com/graphql/v2', {
                    method: 'POST',
                    headers: { 'Authorization': 'Bearer ' + harvestedToken, 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        query: 'mutation ServiceInstanceDeploy($serviceId: String!, $environmentId: String!) { serviceInstanceDeploy(serviceId: $serviceId, environmentId: $environmentId) }',
                        variables: { serviceId, environmentId }
                    })
                }).catch(() => {});
                console.log(`🚀 [Multiverse Daemon] Triggered build and deploy on Railway! Live URL: ${liveUrl}`);

                // 7. Update D1
                await queryD1(
                    'UPDATE repo_deployments SET account_id = ?, railway_project_id = ?, railway_service_id = ?, deployment_status = \'ACTIVE\', live_url = ? WHERE repo_name = ?;',
                    [accountId, projectId, serviceId, liveUrl, repoToAssign]
                );

                await queryD1(
                    'INSERT INTO repo_envs (repo_name, env_key, env_value, updated_at) VALUES (?, \'RAILWAY_TOKEN\', ?, CURRENT_TIMESTAMP) ON CONFLICT(repo_name, env_key) DO UPDATE SET env_value = excluded.env_value, updated_at = CURRENT_TIMESTAMP;',
                    [repoToAssign, harvestedToken]
                );
                console.log(`💾 [Multiverse Daemon] Saved deployment and RAILWAY_TOKEN to D1!`);
            } catch (deployErr) {
                console.error('❌ [Multiverse Daemon] Deployment error:', deployErr.message);
                await queryD1('UPDATE repo_deployments SET account_id = ?, deployment_status = \'ACTIVE\' WHERE repo_name = ?;', [accountId, repoToAssign]).catch(() => {});
            }
        }

        console.log(`🎉 [Multiverse Daemon] End-to-end autonomous flow completed successfully!\n`);
        return {
            success: true,
            accountId,
            email: generatedEmail,
            token: harvestedToken,
            assignedRepo: repoToAssign
        };

    } catch (err) {
        console.error('? [Multiverse Daemon Error]:', err.message);
        return { success: false, error: err.message };
    } finally {
        isAutomationActive = false;
        if (browserContext && (process.env.AUTO_CLOSE_SESSION === 'true' || process.env.HEADLESS === 'true')) {
            await browserContext.close().catch(() => {});
        }
    }
}

// ----------------------------------------------------
// D1 Autonomous Watchdog Loop (Detects Multiverse Uploads)
// ----------------------------------------------------
async function startD1Watchdog() {
    console.log(`?? [Multiverse Daemon] D1 Watchdog active. Polling every ${POLL_INTERVAL_MS / 1000}s for repo deployments...`);

    setInterval(async () => {
        if (isAutomationActive) return;

        try {
            const pendingRepos = await queryD1(
                `SELECT repo_name, deployment_status FROM repo_deployments 
                 WHERE (account_id IS NULL OR deployment_status = 'WAITING_JIT_ACCOUNT') 
                 ORDER BY created_at ASC LIMIT 1;`
            );

            if (pendingRepos && pendingRepos.length > 0) {
                const target = pendingRepos[0].repo_name;
                console.log(`\n?? [Multiverse Daemon] Detected repo waiting for cluster: "${target}"! Triggering autonomous provisioning...`);
                await runAutonomousRailwayProvision(target);
            }
        } catch (pollErr) {
            // Keep poll quiet on transient network glitches
        }
    }, POLL_INTERVAL_MS);
}

// ----------------------------------------------------
// Local HTTP Server for Zero-Latency Instant Triggers
// ----------------------------------------------------
function startHttpServer() {
    const server = http.createServer(async (req, res) => {
        const url = new URL(req.url, `http://${req.headers.host}`);

        // Health check
        if (req.method === 'GET' && url.pathname === '/health') {
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ status: 'ONLINE', isAutomationActive }));
            return;
        }

        // Trigger endpoint: POST /trigger?repo=my-repo
        if (req.method === 'POST' && url.pathname === '/trigger') {
            let body = '';
            req.on('data', chunk => { body += chunk; });
            req.on('end', async () => {
                let repoName = url.searchParams.get('repo') || null;
                try {
                    const parsed = JSON.parse(body || '{}');
                    if (parsed.repoName) repoName = parsed.repoName;
                } catch (e) {}

                if (isAutomationActive) {
                    res.writeHead(429, { 'Content-Type': 'application/json' });
                    res.end(JSON.stringify({ success: false, message: 'Automation already running.' }));
                    return;
                }

                res.writeHead(202, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ success: true, message: 'Autonomous Railway provision triggered.', repoName }));

                runAutonomousRailwayProvision(repoName).catch(() => {});
            });
            return;
        }

        res.writeHead(404, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Endpoint not found' }));
    });

    server.listen(HTTP_PORT, () => {
        console.log(`?? [Multiverse Daemon] HTTP Trigger server listening at http://localhost:${HTTP_PORT} (POST /trigger)`);
    });
}

// ----------------------------------------------------
// Startup Entry Point
// ----------------------------------------------------
console.log('======================================================');
console.log('     Multiverse Autonomous Railway Daemon v1.0        ');
console.log('   Pure Autonomous Engine (No Telegram Dependencies)  ');
console.log('======================================================');

startHttpServer();
startD1Watchdog();

// If run with --instant flag, execute immediately
if (process.argv.includes('--instant')) {
    const cliRepo = process.argv[3] || null;
    runAutonomousRailwayProvision(cliRepo);
}

module.exports = { runAutonomousRailwayProvision };
