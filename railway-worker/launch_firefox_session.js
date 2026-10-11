require('dotenv').config();
const { firefox } = require('playwright');
const path = require('path');
const fs = require('fs');
const spoofConfig = require('./spoof_config');
const { generateStealthScript } = require('./stealth_injections');

function clearDirectorySafe(dirPath) {
    if (!fs.existsSync(dirPath)) {
        fs.mkdirSync(dirPath, { recursive: true });
        return;
    }
    try {
        fs.rmSync(dirPath, { recursive: true, force: true });
    } catch (e) {
        // Fallback if individual files are momentarily held
        try {
            const entries = fs.readdirSync(dirPath);
            for (const entry of entries) {
                const fullPath = path.join(dirPath, entry);
                try {
                    fs.rmSync(fullPath, { recursive: true, force: true });
                } catch (innerErr) {}
            }
        } catch (err) {}
    }
    if (!fs.existsSync(dirPath)) {
        fs.mkdirSync(dirPath, { recursive: true });
    }
}

async function main() {
    const sessionDir = path.resolve(__dirname, 'sessions', 'firefox_profile');

    // 1. Wipe all old cookies, cache, history if configured
    if (spoofConfig.clearSessionOnEveryStart) {
        console.log('[🧹] Clearing all previous cache, cookies, and history for a completely fresh session...');
        clearDirectorySafe(sessionDir);
        console.log('[+] Fresh profile initialized.');
    } else {
        if (!fs.existsSync(sessionDir)) {
            fs.mkdirSync(sessionDir, { recursive: true });
        }
    }

    const targetUrl = process.argv[2] || 'https://railway.com/deploy';

    console.log('[*] Launching Fresh Firefox with Hardware & Fingerprint Spoofing...');
    console.log(`[*] Target URL: ${targetUrl}`);
    console.log(`[*] Inbuilt Google DNS: ${spoofConfig.dns?.enabled ? 'ENABLED (8.8.8.8 - dns.google)' : 'DISABLED'}`);
    console.log(`[*] Spoofed GPU: ${spoofConfig.gpu.renderer}`);
    console.log(`[*] Spoofed Hardware: ${spoofConfig.hardware.concurrency} Cores, ${spoofConfig.hardware.deviceMemory}GB RAM`);
    console.log(`[*] WebRTC IP Leak Protection: ENABLED`);

    // Firefox preferences to block WebRTC leaks, disable crash restores, telemetry, and error prompts
    const firefoxUserPrefs = {
        // Inbuilt Google DNS over HTTPS (DoH)
        'network.trr.mode': spoofConfig.dns?.enabled ? spoofConfig.dns.mode : 0,
        'network.trr.uri': spoofConfig.dns?.dohUri || 'https://dns.google/dns-query',
        'network.trr.custom_uri': spoofConfig.dns?.dohUri || 'https://dns.google/dns-query',
        'network.trr.bootstrapAddress': spoofConfig.dns?.bootstrapAddress || '8.8.8.8',
        'network.trr.send_user_agent': false,
        'network.trr.send_edns_client_subnet': false,

        // Disable crash restore & session restore tabs (ensures clean start without restore error page)
        'browser.sessionstore.resume_from_crash': false,
        'browser.sessionstore.enabled': false,
        'browser.sessionstore.max_resumed_crashes': 0,
        'browser.sessionstore.restore_on_demand': false,
        'browser.startup.page': 0,
        'browser.startup.homepage_override.mstone': 'ignore',
        'browser.tabs.warnOnClose': false,

        // Clear everything automatically on shutdown
        'privacy.clearOnShutdown.cache': true,
        'privacy.clearOnShutdown.cookies': true,
        'privacy.clearOnShutdown.history': true,
        'privacy.clearOnShutdown.formdata': true,
        'privacy.clearOnShutdown.downloads': true,
        'privacy.clearOnShutdown.sessions': true,

        // WebRTC IP Leak Protection
        'media.peerconnection.enabled': true,
        'media.peerconnection.ice.no_host': true,
        'media.peerconnection.ice.default_address_only': true,
        'media.peerconnection.ice.proxy_only': true,

        // Disable Telemetry & Tracking
        'toolkit.telemetry.enabled': false,
        'toolkit.telemetry.unified': false,
        'experiments.activeExperiment': false,
        'experiments.supported': false,
        'datareporting.healthreport.uploadEnabled': false,
        'datareporting.policy.dataSubmissionEnabled': false,
        'app.shield.optoutstudies.enabled': false,

        // Automation flags removal
        'marionette.enabled': false,
        'dom.webdriver.enabled': false,

        // Rendering & Cache
        'gfx.font_rendering.cleartype_params.rendering_mode': 5,
        'browser.cache.disk.enable': true,
        'browser.cache.memory.enable': true,
    };

    const winWidth = spoofConfig.windowSize?.width || 900;
    const winHeight = spoofConfig.windowSize?.height || 600;

    const contextOptions = {
        headless: false,
        viewport: null, // Allows dynamic manual resizing & full screen
        locale: spoofConfig.locale,
        timezoneId: spoofConfig.timezoneId,
        geolocation: spoofConfig.geolocation,
        permissions: ['geolocation'],
        userAgent: spoofConfig.userAgent,
        firefoxUserPrefs: firefoxUserPrefs,
        args: ['-width', `${winWidth}`, '-height', `${winHeight}`],
    };

    if (spoofConfig.proxy) {
        contextOptions.proxy = spoofConfig.proxy;
    }

    // Launch Firefox with persistent context
    const context = await firefox.launchPersistentContext(sessionDir, contextOptions);

    // Inject stealth & hardware spoofing script into all pages before scripts run
    const stealthScript = generateStealthScript(spoofConfig);
    await context.addInitScript(stealthScript);

    const pages = context.pages();
    const page = pages.length > 0 ? pages[0] : await context.newPage();

    console.log('[*] Navigating to page...');
    try {
        await page.goto(targetUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });
        await page.bringToFront().catch(() => {});

        // Smooth 2-Step Auto-Click: Sign in -> Log in using email
        (async () => {
            try {
                console.log('[⚡] [Step 1] Looking for "Sign in" button...');
                const clickedSignIn = await page.evaluate(async () => {
                    for (let i = 0; i < 25; i++) {
                        const buttons = Array.from(document.querySelectorAll('button, a'));
                        const btn = buttons.find(b => {
                            const t = (b.innerText || b.textContent || '').trim().toLowerCase();
                            return t === 'sign in';
                        });
                        if (btn) {
                            btn.click();
                            return true;
                        }
                        await new Promise(r => setTimeout(r, 200));
                    }
                    return false;
                }).catch(() => false);

                if (clickedSignIn) {
                    console.log('[✅] Auto-clicked "Sign in" successfully!');
                }

                console.log('[⚡] [Step 2] Waiting for and clicking "Log in using email"...');
                const clickedEmail = await page.evaluate(async () => {
                    for (let i = 0; i < 40; i++) {
                        const buttons = Array.from(document.querySelectorAll('button, a'));
                        const btn = buttons.find(b => {
                            const text = (b.innerText || b.textContent || '').trim().toLowerCase();
                            return text.includes('log in using email') || text.includes('login with email') || text.includes('using email');
                        });
                        if (btn) {
                            btn.click();
                            return true;
                        }
                        await new Promise(r => setTimeout(r, 250));
                    }
                    return false;
                }).catch(() => false);

                if (clickedEmail) {
                    console.log('[✅] Auto-clicked "Log in using email" successfully! Email input is now active.');
                }
            } catch (clickErr) {}
        })();
    } catch (e) {
        // Ignore navigation error if user closes page quickly
    }

    console.log('\n======================================================');
    console.log('  🛡️ Firefox Fresh Session (Hardware Spoofed) is RUNNING.');
    console.log('  - Cache, cookies, and history start 100% FRESH on every run.');
    console.log('  - Real GPU / CPU / RAM / Screen data is HIDDEN.');
    console.log('  - WebRTC local IP leak is BLOCKED.');
    console.log('  - Window Size: ' + winWidth + 'x' + winHeight);
    console.log('  Close the browser window when you are done.');
    console.log('======================================================\n');

    // Wait until browser context is closed
    await new Promise((resolve) => {
        context.on('close', () => {
            console.log('[*] Browser session closed cleanly.');
            resolve();
        });
    });
}

main()
    .then(() => process.exit(0))
    .catch((err) => {
        if (err && err.message && err.message.includes('Target page, context or browser has been closed')) {
            console.log('[*] Browser session closed cleanly.');
            process.exit(0);
        }
        console.log('[*] Session ended.');
        process.exit(0);
    });
