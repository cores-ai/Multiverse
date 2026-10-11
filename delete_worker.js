/**
 * Autonomous Railway Account Deletion Worker
 * Given an email address (e.g. from Middleman / Multiverse card delete action):
 * 1. Launches browser
 * 2. Logs in using email & auto-polls OTP from Mailu API
 * 3. Navigates to https://railway.com/account
 * 4. Scrolls down to Danger Zone, types confirmation email & deletes account
 */

require('dotenv').config();
const { firefox } = require('playwright');
const path = require('path');
const fs = require('fs');
const spoofConfig = require('./spoof_config');
const { generateStealthScript } = require('./stealth_injections');
const { handleRailwayTermsOfService, deleteCurrentRailwayAccount } = require('./token_harvester');
const { fetchRawOtp, flushInbox } = require('./tempmail_client');

async function runAutonomousDeletion(email, options = {}) {
    if (!email) {
        console.error('❌ TARGET_EMAIL is required for deletion');
        return false;
    }
    if (typeof options === 'string') {
        options = { manualOtp: options };
    }
    const { manualOtp = null, onOtpPrompt = null } = options;
    console.log(`🗑️ [Delete Worker] Starting autonomous Railway account deletion for: ${email}`);

    // Flush old stale messages from the inbox so old expired OTPs don't get picked up
    await flushInbox(email).catch(() => {});

    const isHeadless = process.env.HEADLESS === 'true';
    const contextOptions = {
        headless: isHeadless,
        viewport: null,
        locale: spoofConfig.locale,
        timezoneId: spoofConfig.timezoneId,
        geolocation: spoofConfig.geolocation,
        permissions: ['geolocation'],
        userAgent: spoofConfig.userAgent,
        args: ['-width', '1024', '-height', '768'],
    };

    const tempDir = path.resolve(__dirname, 'sessions', `del_session_${Date.now()}`);
    fs.mkdirSync(tempDir, { recursive: true });

    let browserContext = null;
    try {
        browserContext = await firefox.launchPersistentContext(tempDir, contextOptions);
        const stealthScript = generateStealthScript(spoofConfig);
        await browserContext.addInitScript(stealthScript);

        const pages = browserContext.pages();
        const page = pages.length > 0 ? pages[0] : await browserContext.newPage();

        console.log('🌐 [Delete Worker] Navigating to Railway deploy page...');
        await page.goto('https://railway.com/deploy', { waitUntil: 'domcontentloaded', timeout: 35000 });

        // Step 1: Click Sign in
        await page.evaluate(async () => {
            for (let i = 0; i < 30; i++) {
                const buttons = Array.from(document.querySelectorAll('button, a'));
                const btn = buttons.find(b => (b.innerText || b.textContent || '').trim().toLowerCase() === 'sign in');
                if (btn) { btn.click(); return true; }
                await new Promise(r => setTimeout(r, 500));
            }
            return false;
        }).catch(() => false);

        // Step 2: Click Log in using email
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

        // Step 3: Type email
        const emailInput = page.locator('input[type="email"], input[name="email"]').first();
        await emailInput.waitFor({ state: 'visible', timeout: 15000 });
        await emailInput.fill(email);
        await new Promise(r => setTimeout(r, 500));

        // Step 4: Turnstile bypass
        console.log('🛡️ [Delete Worker] Solving Turnstile...');
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
            await new Promise(r => setTimeout(r, 4000));
        }

        // Step 5: Click Continue with email and wait for PIN screen transition
        console.log('📨 [Delete Worker] Submitting email to Railway...');
        let emailSubmitted = false;
        const emailSentTime = Date.now() - 3000;

        for (let waitBtn = 0; waitBtn < 30; waitBtn++) {
            // Check if Turnstile retry is needed
            const isBtnEnabled = await page.evaluate(() => {
                const btn = Array.from(document.querySelectorAll('button')).find(b =>
                    (b.innerText || '').trim().toLowerCase().includes('continue with email'));
                return btn && !btn.disabled;
            }).catch(() => false);

            if (!isBtnEnabled && turnstileBox && waitBtn % 5 === 0 && waitBtn > 0) {
                console.log('🔄 [Delete Worker] Retrying Turnstile click...');
                const clickX = turnstileBox.x + 28;
                const clickY = turnstileBox.y + (turnstileBox.height / 2);
                await page.mouse.move(clickX, clickY, { steps: 5 }).catch(() => {});
                await page.mouse.down().catch(() => {});
                await new Promise(r => setTimeout(r, 100));
                await page.mouse.up().catch(() => {});
            }

            // Click Continue with email
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
                console.log('✅ [Delete Worker] Clicked "Continue with email" button.');
                break;
            }

            // Fallback Playwright click
            const pBtn = page.locator('button:has-text("Continue with email")').first();
            if (await pBtn.isEnabled({ timeout: 500 }).catch(() => false)) {
                await pBtn.click({ force: true }).catch(() => {});
                emailSubmitted = true;
                console.log('✅ [Delete Worker] Clicked "Continue with email" via Playwright locator.');
                break;
            }

            await new Promise(r => setTimeout(r, 800));
        }

        // Wait for PIN code inputs to appear on screen
        console.log('⏳ [Delete Worker] Waiting for Railway OTP PIN screen to appear...');
        let targetFrame = page;
        let otpScreenReady = false;

        for (let pWait = 0; pWait < 40; pWait++) {
            const frames = [page, ...page.frames()];
            for (const frame of frames) {
                try {
                    if (await frame.locator('#pin-code-input-0, input[data-testid="pin-input-0"]').count() > 0) {
                        targetFrame = frame;
                        otpScreenReady = true;
                        break;
                    }
                } catch (e) {}
            }
            if (otpScreenReady) break;

            const domPin = await page.evaluate(() => {
                return !!(document.querySelector('#pin-code-input-0') || document.querySelector('input[autocomplete="one-time-code"]'));
            }).catch(() => false);
            if (domPin) {
                otpScreenReady = true;
                break;
            }

            await new Promise(r => setTimeout(r, 500));
        }

        if (!otpScreenReady) {
            console.warn('⚠️ [Delete Worker] PIN fields not detected yet, attempting re-click on Continue with email...');
            await page.evaluate(() => {
                const btn = Array.from(document.querySelectorAll('button')).find(b =>
                    (b.innerText || '').trim().toLowerCase().includes('continue with email'));
                if (btn) btn.click();
            }).catch(() => {});
            await new Promise(r => setTimeout(r, 2000));
        }

        // Step 6: Fetch OTP from Mailu API or prompt (now guaranteed that PIN screen is active)
        console.log(`📬 [Delete Worker] Fetching fresh OTP for ${email}...`);
        let otp = manualOtp ? manualOtp.match(/\d{6}/)?.[0] : null;

        if (!otp) {
            try {
                const rawOtp = await fetchRawOtp(email, 25, emailSentTime);
                otp = (rawOtp || '').match(/\d{6}/)?.[0];
            } catch (otpErr) {
                console.warn(`⚠️ [Delete Worker] Auto OTP fetch note: ${otpErr.message}`);
                if (typeof onOtpPrompt === 'function') {
                    console.log('⏳ [Delete Worker] Waiting for manual OTP input...');
                    otp = await onOtpPrompt(email);
                    if (otp) otp = (otp || '').match(/\d{6}/)?.[0];
                }
            }
        }

        if (!otp) throw new Error(`Could not obtain 6-digit OTP for ${email}`);
        console.log(`🔑 [Delete Worker] Got fresh valid OTP: ${otp}`);

        // Step 7: Enter OTP with multi-strategy autofill
        console.log(`✍️ [Delete Worker] Auto-filling OTP: ${otp}...`);
        let filledSuccess = false;

        // Method A: Click first pin input and use keyboard type with human delay (triggers all react listeners)
        try {
            const firstInput = targetFrame.locator('#pin-code-input-0, input[data-testid="pin-input-0"]').first();
            if (await firstInput.isVisible({ timeout: 4000 }).catch(() => false)) {
                await firstInput.scrollIntoViewIfNeeded().catch(() => {});
                await firstInput.click({ force: true }).catch(() => {});
                await new Promise(r => setTimeout(r, 200));
                await page.keyboard.type(otp, { delay: 90 });
                filledSuccess = true;
                console.log('✅ [Delete Worker] OTP entered via Playwright keyboard typing.');
            }
        } catch (keyErr) {
            console.log('⚠️ Keyboard typing note:', keyErr.message);
        }

        // Method B: In-page DOM injection with native setter
        if (!filledSuccess) {
            try {
                filledSuccess = await page.evaluate((code) => {
                    const pin0 = document.querySelector('#pin-code-input-0');
                    if (!pin0) return false;
                    pin0.focus();
                    const nativeSetter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')?.set;
                    for (let i = 0; i < 6; i++) {
                        const input = document.querySelector(`#pin-code-input-${i}`);
                        if (input) {
                            input.focus();
                            if (nativeSetter) {
                                nativeSetter.call(input, code[i]);
                            } else {
                                input.value = code[i];
                            }
                            input.dispatchEvent(new Event('input', { bubbles: true }));
                            input.dispatchEvent(new Event('change', { bubbles: true }));
                            input.dispatchEvent(new KeyboardEvent('keyup', { bubbles: true }));
                        }
                    }
                    return true;
                }, otp).catch(() => false);
                if (filledSuccess) console.log('✅ [Delete Worker] OTP entered via native DOM injection.');
            } catch (domErr) {
                console.log('⚠️ DOM injection note:', domErr.message);
            }
        }

        // Method C: Digit-by-digit locator fill
        if (!filledSuccess) {
            for (let i = 0; i < 6; i++) {
                const digitInput = targetFrame.locator(`#pin-code-input-${i}`).first();
                await digitInput.click({ force: true }).catch(() => {});
                await digitInput.fill(otp[i], { timeout: 3000, force: true }).catch(() => {});
                await new Promise(r => setTimeout(r, 80));
            }
        }

        console.log('✅ [Delete Worker] OTP entered. Waiting for authentication and dashboard redirect...');
        let loginSuccessful = false;

        for (let wait = 0; wait < 20; wait++) {
            await new Promise(r => setTimeout(r, 1000));
            const currentUrl = page.url();

            // Detect if Railway displayed an invalid code error
            const hasError = await page.evaluate(() => {
                const text = (document.body.innerText || '').toLowerCase();
                return text.includes('incorrect code') || text.includes('invalid code') || text.includes('code expired') || text.includes('try again');
            }).catch(() => false);

            if (hasError) {
                throw new Error(`Railway rejected OTP "${otp}" as incorrect/expired. Please generate a fresh code.`);
            }

            if (currentUrl.includes('dashboard') || currentUrl.includes('project') || currentUrl.includes('/account')) {
                loginSuccessful = true;
                break;
            }

            // Check if Terms of service modal is displayed (which also proves successful login)
            const hasTerms = await page.evaluate(() => {
                const text = (document.body.innerText || '').toLowerCase();
                return text.includes('review and accept our terms') || text.includes('terms of service');
            }).catch(() => false);

            if (hasTerms) {
                loginSuccessful = true;
                break;
            }
        }

        if (!loginSuccessful) {
            // Check if we are still stuck on deploy/login page
            const currentUrl = page.url();
            if (!currentUrl.includes('dashboard') && !currentUrl.includes('project') && !currentUrl.includes('/account')) {
                throw new Error(`Login was not completed with OTP ${otp}. Current URL is ${currentUrl}`);
            }
        }

        // Accept TOS if present
        await handleRailwayTermsOfService(page).catch(() => {});

        // Step 8: Execute account deletion!
        console.log('🚨 [Delete Worker] Executing Danger Zone deletion on Railway...');
        await deleteCurrentRailwayAccount(page, email);
        console.log(`🎉 [Delete Worker] Railway account successfully deleted: ${email}`);
        return true;

    } catch (err) {
        console.error('❌ [Delete Worker] Error deleting account:', err.message);
        return false;
    } finally {
        if (browserContext) {
            await browserContext.close().catch(() => {});
        }
        try {
            fs.rmSync(tempDir, { recursive: true, force: true });
        } catch (e) {}
    }
}

if (require.main === module) {
    const targetEmail = process.argv[2] || process.env.TARGET_EMAIL;
    runAutonomousDeletion(targetEmail);
}

module.exports = { runAutonomousDeletion };
