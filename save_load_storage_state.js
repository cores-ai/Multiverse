require('dotenv').config();
const { firefox } = require('playwright');
const path = require('path');
const fs = require('fs');
const spoofConfig = require('./spoof_config');
const { generateStealthScript } = require('./stealth_injections');

const sessionsDir = path.resolve(__dirname, 'sessions');
const stateFilePath = path.join(sessionsDir, 'firefox_state.json');

const firefoxUserPrefs = {
    'network.trr.mode': 2,
    'network.trr.uri': 'https://dns.google/dns-query',
    'network.trr.custom_uri': 'https://dns.google/dns-query',
    'network.trr.bootstrapAddress': '8.8.8.8',
    'network.trr.send_user_agent': false,
    'network.trr.send_edns_client_subnet': false,
    'media.peerconnection.enabled': true,
    'media.peerconnection.ice.no_host': true,
    'media.peerconnection.ice.default_address_only': true,
    'media.peerconnection.ice.proxy_only': true,
    'toolkit.telemetry.enabled': false,
    'marionette.enabled': false,
    'dom.webdriver.enabled': false,
};

async function saveState() {
    if (!fs.existsSync(sessionsDir)) {
        fs.mkdirSync(sessionsDir, { recursive: true });
    }

    const winWidth = spoofConfig.windowSize?.width || 900;
    const winHeight = spoofConfig.windowSize?.height || 600;

    const browser = await firefox.launch({
        headless: false,
        firefoxUserPrefs: firefoxUserPrefs,
        args: [`--width=${winWidth}`, `--height=${winHeight}`]
    });
    const context = await browser.newContext({
        locale: spoofConfig.locale,
        timezoneId: spoofConfig.timezoneId,
        geolocation: spoofConfig.geolocation,
        permissions: ['geolocation'],
        userAgent: spoofConfig.userAgent,
        viewport: null
    });

    const stealthScript = generateStealthScript(spoofConfig);
    await context.addInitScript(stealthScript);

    const page = await context.newPage();
    const targetUrl = process.argv[3] || 'https://railway.com/deploy';
    await page.goto(targetUrl);

    // Auto-click Sign in -> Log in using email
    (async () => {
        try {
            await page.evaluate(async () => {
                for (let i = 0; i < 25; i++) {
                    const buttons = Array.from(document.querySelectorAll('button, a'));
                    const btn = buttons.find(b => (b.innerText || '').trim().toLowerCase() === 'sign in');
                    if (btn) { btn.click(); break; }
                    await new Promise(r => setTimeout(r, 200));
                }
                for (let i = 0; i < 40; i++) {
                    const buttons = Array.from(document.querySelectorAll('button, a'));
                    const btn = buttons.find(b => (b.innerText || '').toLowerCase().includes('using email'));
                    if (btn) { btn.click(); break; }
                    await new Promise(r => setTimeout(r, 250));
                }
            });
        } catch (e) {}
    })();

    console.log('\n======================================================');
    console.log('  Please log in on the website.');
    console.log('  When you are done logging in, close the browser window.');
    console.log('  The session will automatically be exported to JSON.');
    console.log('======================================================\n');

    await new Promise((resolve) => {
        page.on('close', async () => {
            try {
                await context.storageState({ path: stateFilePath });
                console.log(`[+] Session state successfully saved to: ${stateFilePath}`);
            } catch (e) {
                console.error('[-] Error saving state:', e.message);
            }
            resolve();
        });
    });

    await browser.close().catch(() => {});
}

async function loadState() {
    if (!fs.existsSync(stateFilePath)) {
        console.error(`[-] Error: State file not found at ${stateFilePath}. Run "npm run save-state" first.`);
        return;
    }

    const winWidth = spoofConfig.windowSize?.width || 900;
    const winHeight = spoofConfig.windowSize?.height || 600;

    console.log(`[*] Launching Firefox with loaded session state from: ${stateFilePath}`);
    const browser = await firefox.launch({
        headless: false,
        firefoxUserPrefs: firefoxUserPrefs,
        args: [`--width=${winWidth}`, `--height=${winHeight}`]
    });
    const context = await browser.newContext({
        storageState: stateFilePath,
        locale: spoofConfig.locale,
        timezoneId: spoofConfig.timezoneId,
        geolocation: spoofConfig.geolocation,
        permissions: ['geolocation'],
        userAgent: spoofConfig.userAgent,
        viewport: null
    });

    const stealthScript = generateStealthScript(spoofConfig);
    await context.addInitScript(stealthScript);

    const page = await context.newPage();
    const targetUrl = process.argv[3] || 'https://railway.com/deploy';
    await page.goto(targetUrl);

    console.log('\n======================================================');
    console.log('  Firefox running with restored session state & spoofed hardware.');
    console.log('  Close the browser window to exit.');
    console.log('======================================================\n');

    await new Promise((resolve) => {
        page.on('close', () => resolve());
    });

    await browser.close().catch(() => {});
}

const action = process.argv[2] || 'save';

if (action === 'save') {
    saveState();
} else if (action === 'load') {
    loadState();
} else {
    console.log('Usage:');
    console.log('  node save_load_storage_state.js save [url]');
    console.log('  node save_load_storage_state.js load [url]');
}
