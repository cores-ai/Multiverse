require('dotenv').config();
const { firefox } = require('playwright');
const path = require('path');
const fs = require('fs');
const spoofConfig = require('./spoof_config');
const { generateStealthScript } = require('./stealth_injections');

(async () => {
    const sessionDir = path.resolve(__dirname, 'sessions', 'firefox_debug');
    if (!fs.existsSync(sessionDir)) fs.mkdirSync(sessionDir, { recursive: true });

    const context = await firefox.launchPersistentContext(sessionDir, {
        headless: false,
        viewport: null,
        locale: spoofConfig.locale,
        timezoneId: spoofConfig.timezoneId,
        userAgent: spoofConfig.userAgent,
        firefoxUserPrefs: {
            'browser.sessionstore.resume_from_crash': false,
            'browser.sessionstore.enabled': false,
            'browser.startup.page': 0,
            'marionette.enabled': false,
            'dom.webdriver.enabled': false,
        },
        args: ['-width', '900', '-height', '600'],
    });

    const stealthScript = generateStealthScript(spoofConfig);
    await context.addInitScript(stealthScript);

    const page = context.pages()[0] || await context.newPage();
    
    console.log('[*] Navigating to railway.com/deploy ...');
    await page.goto('https://railway.com/deploy', { waitUntil: 'domcontentloaded', timeout: 30000 });

    // Step 1: Click Sign in
    console.log('[*] Looking for Sign in...');
    await page.evaluate(async () => {
        for (let i = 0; i < 40; i++) {
            const btn = Array.from(document.querySelectorAll('button, a')).find(b => (b.innerText || '').trim().toLowerCase() === 'sign in');
            if (btn) { btn.click(); return true; }
            await new Promise(r => setTimeout(r, 500));
        }
        return false;
    });
    console.log('[*] Sign in clicked');

    // Step 2: Click Log in using email
    console.log('[*] Looking for Log in using email...');
    await page.evaluate(async () => {
        for (let i = 0; i < 40; i++) {
            const btn = Array.from(document.querySelectorAll('button, a')).find(b => {
                const t = (b.innerText || '').trim().toLowerCase();
                return t.includes('log in using email') || t.includes('using email');
            });
            if (btn) { btn.click(); return true; }
            await new Promise(r => setTimeout(r, 500));
        }
        return false;
    });
    console.log('[*] Log in using email clicked');

    // Type email
    console.log('[*] Typing email...');
    const emailInput = page.locator('input[type="email"], input[name="email"]').first();
    await emailInput.waitFor({ state: 'visible', timeout: 10000 });
    await emailInput.click();
    await emailInput.pressSequentially('test@example.com', { delay: 80 });
    console.log('[*] Email typed. Now waiting 3 seconds for Turnstile to render...');
    await new Promise(r => setTimeout(r, 3000));

    // DEBUG: Dump ALL iframes
    console.log('\n========== ALL IFRAMES ON PAGE ==========');
    const iframeInfo = await page.evaluate(() => {
        const iframes = document.querySelectorAll('iframe');
        return Array.from(iframes).map((f, i) => ({
            index: i,
            src: f.src || '(no src)',
            title: f.title || '(no title)',
            name: f.name || '(no name)',
            id: f.id || '(no id)',
            className: f.className || '(no class)',
            width: f.width,
            height: f.height,
            style: f.style.cssText,
            visible: f.offsetParent !== null || f.offsetWidth > 0,
        }));
    });
    
    for (const info of iframeInfo) {
        console.log(`\n--- iframe #${info.index} ---`);
        console.log(`  src: ${info.src}`);
        console.log(`  title: ${info.title}`);
        console.log(`  name: ${info.name}`);
        console.log(`  id: ${info.id}`);
        console.log(`  class: ${info.className}`);
        console.log(`  size: ${info.width}x${info.height}`);
        console.log(`  style: ${info.style}`);
        console.log(`  visible: ${info.visible}`);
    }
    
    if (iframeInfo.length === 0) {
        console.log('  NO IFRAMES FOUND ON PAGE!');
    }

    // DEBUG: Check page.frames()
    console.log('\n========== PLAYWRIGHT FRAMES ==========');
    const frames = page.frames();
    for (let i = 0; i < frames.length; i++) {
        const f = frames[i];
        console.log(`\n--- frame #${i} ---`);
        console.log(`  name: ${f.name()}`);
        console.log(`  url: ${f.url()}`);
        
        // Try to find checkbox inside this frame
        try {
            const checkboxCount = await f.locator('input[type="checkbox"]').count();
            const labelCount = await f.locator('label').count();
            console.log(`  checkboxes: ${checkboxCount}`);
            console.log(`  labels: ${labelCount}`);
            
            if (checkboxCount > 0) {
                const ariaLabel = await f.locator('input[type="checkbox"]').first().getAttribute('aria-label').catch(() => 'N/A');
                console.log(`  checkbox aria-label: ${ariaLabel}`);
            }
        } catch(e) {
            console.log(`  error reading frame content: ${e.message}`);
        }
    }

    // DEBUG: Check for Turnstile div wrapper
    console.log('\n========== TURNSTILE WRAPPER ==========');
    const turnstileInfo = await page.evaluate(() => {
        // Look for any element with turnstile-related attributes
        const candidates = document.querySelectorAll('[class*="turnstile"], [id*="turnstile"], [class*="cf-"], [id*="cf-"], [data-turnstile], div[style*="width: 300px"]');
        return Array.from(candidates).map(el => ({
            tag: el.tagName,
            id: el.id,
            className: el.className,
            innerHTML: el.innerHTML.substring(0, 200),
        }));
    });
    
    for (const t of turnstileInfo) {
        console.log(`  ${t.tag} id="${t.id}" class="${t.className}"`);
        console.log(`    html: ${t.innerHTML}`);
    }

    console.log('\n========== DEBUG COMPLETE ==========');
    console.log('Close the browser when done inspecting.');
    
    await new Promise(resolve => context.on('close', resolve));
    console.log('[*] Browser closed.');
})();
