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
const { fetchRawOtp } = require('./tempmail_client');

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

        // Step 5: Click Continue with email
        await page.evaluate(async () => {
            for (let i = 0; i < 20; i++) {
                const btn = Array.from(document.querySelectorAll('button')).find(b =>
                    (b.innerText || '').trim().toLowerCase().includes('continue with email'));
                if (btn && !btn.disabled) { btn.click(); return true; }
                await new Promise(r => setTimeout(r, 500));
            }
        }).catch(() => {});

        // Step 6: Fetch OTP from Mailu API or prompt
        console.log(`📬 [Delete Worker] Fetching OTP for ${email}...`);
        let otp = manualOtp ? manualOtp.match(/\d{6}/)?.[0] : null;

        if (!otp) {
            try {
                const rawOtp = await fetchRawOtp(email, 25);
                otp = (rawOtp || '').match(/\d{6}/)?.[0];
            } catch (otpErr) {
                console.warn(`⚠️ [Delete Worker] Auto OTP fetch not ready: ${otpErr.message}`);
                if (typeof onOtpPrompt === 'function') {
                    console.log('⏳ [Delete Worker] Waiting for manual OTP input...');
                    otp = await onOtpPrompt(email);
                    if (otp) otp = (otp || '').match(/\d{6}/)?.[0];
                }
            }
        }

        if (!otp) throw new Error(`Could not obtain 6-digit OTP for ${email}`);
        console.log(`🔑 [Delete Worker] Got OTP: ${otp}`);

        // Step 7: Enter OTP with ultra-resilient multi-fallback detection & typing
        let targetFrame = page;
        let otpFound = false;

        for (let attempt = 0; attempt < 50; attempt++) {
            const frames = [page, ...page.frames()];
            for (const frame of frames) {
                try {
                    const hasPin0 = await frame.locator('#pin-code-input-0, input[data-testid="pin-input-0"]').count() > 0;
                    if (hasPin0) {
                        targetFrame = frame;
                        otpFound = true;
                        break;
                    }
                } catch (e) {}
            }
            if (otpFound) break;

            // Also check for any 6 pin inputs via querySelector
            const domPin = await page.evaluate(() => {
                return !!(document.querySelector('#pin-code-input-0') || document.querySelector('input[autocomplete="one-time-code"]'));
            }).catch(() => false);
            if (domPin) {
                otpFound = true;
                break;
            }

            await new Promise(r => setTimeout(r, 500));
        }

        if (!otpFound) {
            throw new Error('OTP input fields not found. The Railway login modal may not have finished transitioning.');
        }

        console.log(`✍️ [Delete Worker] Typing OTP: ${otp}...`);
        let filledSuccess = false;

        // Method A: In-page DOM injection (instant & immune to overlay/pointer-events blocks)
        try {
            filledSuccess = await page.evaluate((code) => {
                let success = false;
                const pin0 = document.querySelector('#pin-code-input-0');
                if (pin0) {
                    pin0.focus();
                    for (let i = 0; i < 6; i++) {
                        const input = document.querySelector(`#pin-code-input-${i}`);
                        if (input) {
                            input.focus();
                            input.value = code[i];
                            input.dispatchEvent(new Event('input', { bubbles: true }));
                            input.dispatchEvent(new Event('change', { bubbles: true }));
                            success = true;
                        }
                    }
                }
                return success;
            }, otp);
        } catch (domErr) {
            console.log('⚠️ DOM direct OTP set note:', domErr.message);
        }

        // Method B: Playwright keyboard type if DOM method didn't trigger auto-submit
        if (!filledSuccess) {
            try {
                const firstInput = targetFrame.locator('#pin-code-input-0, input[data-testid="pin-input-0"]').first();
                await firstInput.scrollIntoViewIfNeeded().catch(() => {});
                await firstInput.click({ timeout: 5000, force: true }).catch(() => {});
                await page.keyboard.type(otp, { delay: 100 });
                filledSuccess = true;
            } catch (clickErr) {
                console.log('⚠️ Keyboard typing note:', clickErr.message);
            }
        }

        // Method C: Digit-by-digit locator fill with force
        if (!filledSuccess) {
            for (let i = 0; i < 6; i++) {
                const digitInput = targetFrame.locator(`#pin-code-input-${i}`).first();
                await digitInput.fill(otp[i], { timeout: 3000, force: true }).catch(() => {});
                await new Promise(r => setTimeout(r, 80));
            }
        }

        console.log('✅ [Delete Worker] OTP entered successfully. Waiting for dashboard navigation...');
        await new Promise(r => setTimeout(r, 6000));

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
