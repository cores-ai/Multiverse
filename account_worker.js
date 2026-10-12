/**
 * Railway Autonomous Account & API Token Harvester Worker
 * Uses persistent Playwright browser with full hardware & stealth spoofing.
 * Integrates Mailu.site for automated disposable email and raw OTP fetching.
 * Posts the generated API Token to Middleman Webhook.
 */

require('dotenv').config();
const { firefox, chromium } = require('playwright');
const path = require('path');
const fs = require('fs');
const spoofConfig = require('./spoof_config');
const { generateStealthScript } = require('./stealth_injections');
const { harvestRailwayApiToken, dispatchTokenToMiddleman } = require('./token_harvester');
const { generateTempEmail, fetchRawOtp } = require('./tempmail_client');

const MIDDLEMAN_WEBHOOK_URL = process.env.MIDDLEMAN_WEBHOOK_URL || 'http://localhost:3000/api/webhooks/account-ready';
const WEBHOOK_SECRET = process.env.WEBHOOK_SECRET || 'mega-server-jit-worker-secret-2026';

async function launchResilientBrowser() {
    const isHeadless = process.env.HEADLESS !== 'false';
    const chromePath = process.platform === 'darwin' 
        ? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
        : 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';

    // 1. If system Chrome exists, prefer Chrome for high Turnstile & stability
    if (fs.existsSync(chromePath)) {
        try {
            console.log('🌐 [Browser Engine] Launching High-Performance Chrome...');
            return await chromium.launch({
                executablePath: chromePath,
                headless: isHeadless,
                args: [
                    '--no-sandbox',
                    '--disable-setuid-sandbox',
                    '--disable-blink-features=AutomationControlled'
                ]
            });
        } catch (e) {
            console.log('⚠️ Chrome launch fallback to Firefox:', e.message);
        }
    }

    // 2. Firefox with stealth spoofing
    console.log('🦊 [Browser Engine] Launching Stealth Firefox...');
    const dohUri = (spoofConfig.dns && (spoofConfig.dns.dohUri || spoofConfig.dns.uri)) || 'https://dns.google/dns-query';
    return await firefox.launch({
        headless: isHeadless,
        firefoxUserPrefs: {
            'network.trr.mode': 2,
            'network.trr.uri': dohUri,
            'media.peerconnection.ice.default_address_only': true,
            'dom.webdriver.enabled': false
        }
    });
}

async function loginWithEmailAndSubmitOtp(page, emailToUse) {
    console.log(`🌐 [Account Worker] Navigating to Railway for email initiation (${emailToUse})...`);
    await page.goto('https://railway.com', { waitUntil: 'domcontentloaded', timeout: 30000 }).catch(async () => {
        await page.goto('https://railway.app', { waitUntil: 'domcontentloaded', timeout: 25000 }).catch(() => {});
    });

    await new Promise(r => setTimeout(r, 1500));

    // Step 1: Click "Sign in"
    console.log('🔍 [Account Worker] Finding and clicking "Sign in"...');
    await page.evaluate(async () => {
        for (let i = 0; i < 25; i++) {
            const buttons = Array.from(document.querySelectorAll('button, a'));
            const btn = buttons.find(b => {
                const t = (b.innerText || b.textContent || '').trim().toLowerCase();
                return t === 'sign in';
            });
            if (btn) { btn.click(); return true; }
            await new Promise(r => setTimeout(r, 200));
        }
        return false;
    }).catch(() => {});

    await new Promise(r => setTimeout(r, 1200));

    // Step 2: Click "Log in using email"
    console.log('🔍 [Account Worker] Finding and clicking "Log in using email"...');
    await page.evaluate(async () => {
        for (let i = 0; i < 40; i++) {
            const buttons = Array.from(document.querySelectorAll('button, a'));
            const btn = buttons.find(b => {
                const text = (b.innerText || b.textContent || '').trim().toLowerCase();
                return text.includes('log in using email') || text.includes('login with email') || text.includes('using email');
            });
            if (btn) { btn.click(); return true; }
            await new Promise(r => setTimeout(r, 300));
        }
        return false;
    }).catch(() => {});

    await new Promise(r => setTimeout(r, 1000));

    // Step 3: Fill email input
    console.log(`⌨️ [Account Worker] Entering email address: ${emailToUse}...`);
    try {
        const emailInput = page.locator('input[type="email"], input[name="email"]').first();
        await emailInput.waitFor({ state: 'visible', timeout: 12000 });
        await emailInput.fill(emailToUse);
        await new Promise(r => setTimeout(r, 500));

        // Step 4: Handle Cloudflare Turnstile & Wait for enabled submit button
        console.log('🛡️ [Account Worker] Checking Cloudflare Turnstile and button readiness...');
        let buttonEnabled = false;

        for (let attempt = 0; attempt < 40; attempt++) {
            const status = await page.evaluate(() => {
                const btn = Array.from(document.querySelectorAll('button')).find(b =>
                    (b.innerText || '').trim().toLowerCase().includes('continue with email'));
                const input = document.querySelector('input[name="cf-turnstile-response"]');
                const hasTurnstileToken = input && input.value && input.value.length > 20;
                
                let rect = null;
                if (input && input.parentElement) {
                    const r = input.parentElement.getBoundingClientRect();
                    if (r.width > 0 && r.height > 0) {
                        rect = { x: r.x, y: r.y, width: r.width, height: r.height };
                    }
                }

                return {
                    isBtnEnabled: btn && !btn.disabled,
                    hasTurnstileToken: !!hasTurnstileToken,
                    turnstileBox: rect
                };
            }).catch(() => ({ isBtnEnabled: false }));

            if (status.isBtnEnabled) {
                buttonEnabled = true;
                console.log('✅ [Account Worker] Submit button is enabled!');
                break;
            }

            if (status.turnstileBox && attempt < 8) {
                console.log('⚡ [Account Worker] Interacting with Cloudflare Turnstile...');
                const bx = status.turnstileBox;
                const clickX = bx.x + 28;
                const clickY = bx.y + (bx.height / 2);
                await page.mouse.move(clickX, clickY, { steps: 5 });
                await page.mouse.click(clickX, clickY);
            }

            await new Promise(r => setTimeout(r, 800));
        }

        // Step 5: Click "Continue with email"
        console.log('📨 [Account Worker] Clicking "Continue with email" to dispatch OTP...');
        const clickResult = await page.evaluate(async () => {
            const btn = Array.from(document.querySelectorAll('button')).find(b =>
                (b.innerText || '').trim().toLowerCase().includes('continue with email'));
            if (btn && !btn.disabled) {
                btn.click();
                return true;
            }
            return false;
        }).catch(() => false);

        if (!clickResult) {
            console.warn('⚠️ [Account Worker] Warning: Submit button was still disabled after wait window.');
        }

        console.log(`⏳ [Account Worker] OTP requested from Railway! Polling disposable mailbox ${emailToUse}...`);

        // Step 6: Poll for 6-digit OTP from Mailu.site
        let receivedOtp = null;
        try {
            receivedOtp = await fetchRawOtp(emailToUse, 35);
        } catch (otpErr) {
            console.warn('⚠️ [Account Worker] OTP fetch warning:', otpErr.message);
        }

        if (receivedOtp && /^\d{6}$/.test(receivedOtp.trim())) {
            const cleanOtp = receivedOtp.trim();
            console.log(`🔑 [Account Worker] Successfully obtained OTP: ${cleanOtp}. Typing digits...`);

            // Find PIN input
            let firstInput = null;
            let targetFrame = page;

            for (let attempt = 0; attempt < 30; attempt++) {
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
                await new Promise(r => setTimeout(r, 400));
            }

            if (firstInput) {
                await firstInput.click();
                for (let i = 0; i < 6; i++) {
                    const input = targetFrame.locator(`#pin-code-input-${i}`);
                    await input.click().catch(() => {});
                    await input.fill(cleanOtp[i]).catch(() => {});
                    await new Promise(r => setTimeout(r, 120));
                }
                console.log('✅ [Account Worker] Submitted all 6 OTP digits to Railway.');
                await new Promise(r => setTimeout(r, 4000));

                // Accept Terms of Service if modal displays
                try {
                    for (let attempt = 0; attempt < 10; attempt++) {
                        const clickedTos = await page.evaluate(() => {
                            const btns = Array.from(document.querySelectorAll('button'));
                            const agreeBtn = btns.find(b => {
                                const text = (b.innerText || b.textContent || '').toLowerCase();
                                return (text.includes('i agree') || text.includes('accept')) && !b.disabled;
                            });
                            if (agreeBtn) { agreeBtn.click(); return true; }
                            return false;
                        }).catch(() => false);
                        if (clickedTos) {
                            console.log('📜 [Account Worker] Accepted Railway Terms of Service.');
                            await new Promise(r => setTimeout(r, 1500));
                        } else {
                            break;
                        }
                    }
                } catch (tosErr) {}
            }
        }
    } catch (loginErr) {
        console.warn('⚠️ [Account Worker] Login interaction notice:', loginErr.message);
    }
}

async function generateAndHarvestAccount(customEmail = null) {
    console.log('🚀 [Account Worker] Initiating Just-In-Time Railway account generator with stealth spoofing...');
    
    // Automatically generate temporary email via Mailu.site or use custom/env
    let emailToUse = customEmail || process.env.TARGET_EMAIL || generateTempEmail();
    if (emailToUse) {
        const [u, d] = emailToUse.split('@');
        emailToUse = `${(u || '').replace(/[_.]/g, '')}@${d || 'mailu.site'}`;
    }
    console.log(`✉️ [Account Worker] Clean Disposable Email Target: ${emailToUse}`);
    
    const browser = await launchResilientBrowser();

    const context = await browser.newContext({
        userAgent: spoofConfig.userAgent,
        viewport: spoofConfig.screen,
        timezoneId: spoofConfig.timezoneId
    });

    const page = await context.newPage();
    await page.addInitScript(generateStealthScript(spoofConfig));

    console.log(`🌐 [Account Worker] Browser session ready. Executing full email + OTP auth for: ${emailToUse}`);

    try {
        // Run full login + OTP flow
        await loginWithEmailAndSubmitOtp(page, emailToUse);

        let harvestedApiToken = null;
        try {
            // Attempt live intercept on Railway tokens page
            const harvestResult = await harvestRailwayApiToken(page, 20000);
            harvestedApiToken = harvestResult.token;
        } catch (harvestErr) {
            console.error('❌ [Account Worker] Live token harvest failed:', harvestErr.message);
        }

        if (!harvestedApiToken) {
            console.warn('⚠️ [Account Worker] No verified Railway token intercepted. Skipping account creation in database to prevent fake cards.');
            return { success: false, reason: 'TOKEN_NOT_HARVESTED' };
        }

        console.log(`🔑 [Account Worker] Harvested token: ${harvestedApiToken.substring(0, 14)}...`);

        // Dispatch token to Middleman Webhook ONLY when real token is harvested!
        const resData = await dispatchTokenToMiddleman({
            email: emailToUse,
            apiToken: harvestedApiToken,
            webhookUrl: MIDDLEMAN_WEBHOOK_URL,
            secretKey: WEBHOOK_SECRET
        });

        console.log('✅ [Account Worker] Middleman registered account successfully:', resData);
        return { success: true, token: harvestedApiToken, email: emailToUse, account: resData };
    } catch (err) {
        console.error('❌ [Account Worker] Error harvesting/dispatching account:', err.message);
        throw err;
    } finally {
        await browser.close().catch(() => {});
    }
}

// Allow running directly from command line: node account_worker.js
if (require.main === module) {
    generateAndHarvestAccount()
        .then(() => process.exit(0))
        .catch(() => process.exit(1));
}

module.exports = { generateAndHarvestAccount, launchResilientBrowser, fetchRawOtp, generateTempEmail };
