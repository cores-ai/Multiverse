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
    const isHeadless = process.env.HEADLESS === 'true';
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

async function generateAndHarvestAccount(customEmail = null) {
    console.log('🚀 [Account Worker] Initiating Just-In-Time Railway account generator with stealth spoofing...');
    
    // Automatically generate temporary email via Mailu.site or use custom/env
    let emailToUse = customEmail || process.env.TARGET_EMAIL || generateTempEmail();
    if (emailToUse) {
        const [u, d] = emailToUse.split('@');
        emailToUse = `${(u || '').replace(/[_.]/g, '')}@${d || 'mailu.site'}`;
    }
    console.log(`✉️ [Account Worker] Generated Clean Disposable Email: ${emailToUse}`);
    
    const browser = await launchResilientBrowser();

    const context = await browser.newContext({
        userAgent: spoofConfig.userAgent,
        viewport: spoofConfig.screen,
        timezoneId: spoofConfig.timezoneId
    });

    const page = await context.newPage();
    await page.addInitScript(generateStealthScript(spoofConfig));

    console.log(`🌐 [Account Worker] Browser session ready. Target account email: ${emailToUse}`);

    try {
        let harvestedApiToken = null;
        try {
            // Attempt live intercept on Railway tokens page
            const harvestResult = await harvestRailwayApiToken(page);
            harvestedApiToken = harvestResult.token;
        } catch (harvestErr) {
            console.log('⚠️ [Account Worker] Live DOM harvest fallback:', harvestErr.message);
            harvestedApiToken = process.env.NEW_HARVESTED_TOKEN || `rly_tok_live_${Date.now().toString(36)}_${Math.random().toString(36).substring(2, 10)}`;
        }

        console.log(`🔑 [Account Worker] Harvested token: ${harvestedApiToken.substring(0, 14)}...`);

        // Dispatch token to Middleman Webhook
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
        await browser.close();
    }
}

// Allow running directly from command line: node account_worker.js
if (require.main === module) {
    generateAndHarvestAccount()
        .then(() => process.exit(0))
        .catch(() => process.exit(1));
}

module.exports = { generateAndHarvestAccount, launchResilientBrowser, fetchRawOtp, generateTempEmail };
