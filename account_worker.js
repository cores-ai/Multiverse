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
const { harvestRailwayApiToken, dispatchTokenToMiddleman, handleRailwayTermsOfService } = require('./token_harvester');
const { generateTempEmail, fetchRawOtp } = require('./tempmail_client');

const MIDDLEMAN_WEBHOOK_URL = process.env.MIDDLEMAN_WEBHOOK_URL || 'http://localhost:3000/api/webhooks/account-ready';
const WEBHOOK_SECRET = process.env.WEBHOOK_SECRET || 'mega-server-jit-worker-secret-2026';

async function launchResilientBrowser() {
    const isHeadless = process.env.HEADLESS === 'true';
    const dohUri = (spoofConfig.dns && (spoofConfig.dns.dohUri || spoofConfig.dns.uri)) || 'https://dns.google/dns-query';
    const tempDir = path.resolve(__dirname, 'sessions', `acc_session_${Date.now()}`);
    fs.mkdirSync(tempDir, { recursive: true });

    console.log('🦊 [Browser Engine] Launching High-Performance Stealth Firefox...');
    const context = await firefox.launchPersistentContext(tempDir, {
        headless: isHeadless,
        viewport: null,
        locale: spoofConfig.locale,
        timezoneId: spoofConfig.timezoneId,
        geolocation: spoofConfig.geolocation,
        permissions: ['geolocation'],
        userAgent: spoofConfig.userAgent,
        args: ['-width', '1024', '-height', '768'],
        firefoxUserPrefs: {
            'network.trr.mode': 2,
            'network.trr.uri': dohUri,
            'media.peerconnection.ice.default_address_only': true,
            'dom.webdriver.enabled': false
        }
    });

    const stealthScript = generateStealthScript(spoofConfig);
    await context.addInitScript(stealthScript);
    return context;
}

async function loginWithEmailAndSubmitOtp(page, emailToUse) {
    console.log(`🌐 [Account Worker] Navigating to Railway deploy page (${emailToUse})...`);
    await page.goto('https://railway.com/deploy', { waitUntil: 'domcontentloaded', timeout: 35000 });
    await new Promise(r => setTimeout(r, 1000));

    // Step 1: Click "Sign in"
    console.log('🔍 [Account Worker] Finding and clicking "Sign in"...');
    await page.evaluate(async () => {
        for (let i = 0; i < 30; i++) {
            const buttons = Array.from(document.querySelectorAll('button, a'));
            const btn = buttons.find(b => (b.innerText || b.textContent || '').trim().toLowerCase() === 'sign in');
            if (btn) { btn.click(); return true; }
            await new Promise(r => setTimeout(r, 500));
        }
        return false;
    }).catch(() => false);

    await new Promise(r => setTimeout(r, 800));

    // Step 2: Click "Log in using email"
    console.log('🔍 [Account Worker] Finding and clicking "Log in using email"...');
    await page.evaluate(async () => {
        for (let i = 0; i < 30; i++) {
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

    await new Promise(r => setTimeout(r, 800));

    // Step 3: Fill email input
    console.log(`⌨️ [Account Worker] Entering email address: ${emailToUse}...`);
    try {
        const emailInput = page.locator('input[type="email"], input[name="email"]').first();
        await emailInput.waitFor({ state: 'visible', timeout: 15000 });
        await emailInput.fill(emailToUse);
        await new Promise(r => setTimeout(r, 500));

        // Step 4: Turnstile bypass
        console.log('🛡️ [Account Worker] Solving Turnstile...');
        let turnstileBox = null;
        for (let attempt = 0; attempt < 25; attempt++) {
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

            if (box) { turnstileBox = box; break; }
            await new Promise(r => setTimeout(r, 500));
        }

        if (turnstileBox) {
            const clickX = turnstileBox.x + 28;
            const clickY = turnstileBox.y + (turnstileBox.height / 2);
            await page.mouse.move(clickX, clickY, { steps: 8 });
            await page.mouse.down();
            await new Promise(r => setTimeout(r, 100));
            await page.mouse.up();
            console.log('🛡️ [Account Worker] Clicked Turnstile checkbox coordinates.');
            await new Promise(r => setTimeout(r, 3500));
        }

        // Step 5: Click Continue with email
        console.log('📨 [Account Worker] Clicking "Continue with email" to dispatch OTP...');
        let emailSubmitted = false;
        for (let waitBtn = 0; waitBtn < 30; waitBtn++) {
            const isBtnEnabled = await page.evaluate(() => {
                const btn = Array.from(document.querySelectorAll('button')).find(b =>
                    (b.innerText || '').trim().toLowerCase().includes('continue with email'));
                return btn && !btn.disabled;
            }).catch(() => false);

            if (!isBtnEnabled && turnstileBox && waitBtn % 5 === 0 && waitBtn > 0) {
                console.log('🔄 [Account Worker] Retrying Turnstile click...');
                const clickX = turnstileBox.x + 28;
                const clickY = turnstileBox.y + (turnstileBox.height / 2);
                await page.mouse.move(clickX, clickY, { steps: 5 }).catch(() => {});
                await page.mouse.down().catch(() => {});
                await new Promise(r => setTimeout(r, 100));
                await page.mouse.up().catch(() => {});
            }

            const clicked = await page.evaluate(() => {
                const btn = Array.from(document.querySelectorAll('button')).find(b =>
                    (b.innerText || '').trim().toLowerCase().includes('continue with email'));
                if (btn && !btn.disabled) {
                    btn.click();
                    return true;
                }
                return false;
            }).catch(() => false);

            if (clicked) {
                emailSubmitted = true;
                console.log('✅ [Account Worker] Clicked "Continue with email" button.');
                break;
            }
            await new Promise(r => setTimeout(r, 500));
        }

        if (!emailSubmitted) {
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
                
                console.log('⏳ [Account Worker] Waiting for authentication and dashboard redirect...');
                let loginSuccessful = false;
                for (let wait = 0; wait < 25; wait++) {
                    await new Promise(r => setTimeout(r, 1000));
                    const currentUrl = page.url();

                    const hasError = await page.evaluate(() => {
                        const text = (document.body.innerText || '').toLowerCase();
                        return text.includes('incorrect code') || text.includes('invalid code') || text.includes('code expired') || text.includes('try again');
                    }).catch(() => false);

                    if (hasError) {
                        throw new Error(`Railway rejected OTP as incorrect/expired.`);
                    }

                    if (currentUrl.includes('dashboard') || currentUrl.includes('project') || currentUrl.includes('/account')) {
                        loginSuccessful = true;
                        break;
                    }

                    const hasTerms = await page.evaluate(() => {
                        const text = (document.body.innerText || '').toLowerCase();
                        return text.includes('review and accept our terms') || text.includes('terms of service') || text.includes('scroll to read all terms');
                    }).catch(() => false);

                    if (hasTerms) {
                        loginSuccessful = true;
                        break;
                    }
                }

                // Resilient Terms of Service clearing (1/2 and 2/2)
                await handleRailwayTermsOfService(page).catch(() => {});
            }
        }
    } catch (loginErr) {
        console.warn('⚠️ [Account Worker] Login interaction notice:', loginErr.message);
    }
}

async function generateAndHarvestAccount(customEmail = null) {
    console.log('🚀 [Account Worker] Initiating Just-In-Time Railway account generator with stealth spoofing...');
    
    // Automatically generate temporary email via Mailu.site or use custom/env
    let emailToUse = customEmail || process.env.TARGET_EMAIL || (await generateTempEmail());
    if (emailToUse) {
        const [u, d] = String(emailToUse).split('@');
        emailToUse = `${(u || '').replace(/[_.]/g, '')}@${d || 'mailu.site'}`;
    }
    console.log(`🎯 [Account Worker] Clean Disposable Email Target: ${emailToUse}`);
    
    const context = await launchResilientBrowser();
    const pages = context.pages();
    const page = pages.length > 0 ? pages[0] : await context.newPage();

    console.log(`🌐 [Account Worker] Browser session ready. Executing full email + OTP auth for: ${emailToUse}`);

    try {
        // Run full login + OTP flow
        await loginWithEmailAndSubmitOtp(page, emailToUse);

        let harvestedApiToken = null;
        try {
            // Attempt live intercept on Railway tokens page
            const harvestResult = await harvestRailwayApiToken(page, 25000);
            harvestedApiToken = harvestResult.token;
        } catch (harvestErr) {
            console.error('❌ [Account Worker] Live token harvest failed:', harvestErr.message);
        }

        if (!harvestedApiToken) {
            console.warn('⚠️ [Account Worker] No verified Railway token intercepted. Skipping account creation in database to prevent fake cards.');
            return { success: false, reason: 'TOKEN_NOT_HARVESTED' };
        }

        console.log(`🔑 [Account Worker] Harvested token: ${harvestedApiToken.substring(0, 14)}...`);

        // 1. Dispatch token to Middleman Webhook
        try {
            const resData = await dispatchTokenToMiddleman({
                email: emailToUse,
                apiToken: harvestedApiToken,
                webhookUrl: MIDDLEMAN_WEBHOOK_URL,
                secretKey: WEBHOOK_SECRET
            });
            console.log('✅ [Account Worker] Webhook dispatch succeeded:', resData);
        } catch (dispatchErr) {
            console.warn('⚠️ [Account Worker] Webhook dispatch notice:', dispatchErr.message);
        }

        // 2. Direct Auto-Deployment Execution: Deploy Coras-Multiverse/giveaway & inject all D1 envs
        console.log('🚀 [Account Worker] Executing full repository deployment on Railway...');
        let deployRes = null;
        try {
            const { deployRepositoryToRailway } = await import('./lib/railway.js');
            deployRes = await deployRepositoryToRailway({
                apiToken: harvestedApiToken,
                repoName: 'giveaway',
                githubOrg: 'Coras-Multiverse'
            });
            console.log(`🎉 [Account Worker] Direct autonomous deployment completed successfully! Live URL: ${deployRes.liveUrl}`);
        } catch (directDeployErr) {
            console.warn('⚠️ [Account Worker] Direct deploy notice:', directDeployErr.message);
        }

        return { success: true, token: harvestedApiToken, email: emailToUse, deployment: deployRes };
    } catch (err) {
        console.error('❌ [Account Worker] Error harvesting/dispatching account:', err.message);
        throw err;
    } finally {
        await context.close().catch(() => {});
    }
}

if (require.main === module) {
    generateAndHarvestAccount()
        .then(() => process.exit(0))
        .catch(() => process.exit(1));
}

module.exports = { generateAndHarvestAccount, launchResilientBrowser, fetchRawOtp, generateTempEmail };
