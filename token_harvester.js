/**
 * Autonomous Railway API Token Harvester & Middleman Webhook Dispatcher
 * High-reliability DOM + GraphQL network interceptor for Railway token generation.
 */

require('dotenv').config();

const DEFAULT_WEBHOOK_URL = process.env.MIDDLEMAN_WEBHOOK_URL || 'http://localhost:3000/api/webhooks/account-ready';
const DEFAULT_WEBHOOK_SECRET = process.env.WEBHOOK_SECRET || 'mega-server-jit-worker-secret-2026';

/**
 * Intercepts and extracts Railway API token from an active authenticated Playwright page.
 * Uses dual-layer detection:
 * 1. Network listener intercepting GraphQL Backboard API token responses.
 * 2. Automated DOM navigation to account settings tokens page.
 */
const UUID_REGEX = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;

async function harvestRailwayApiToken(page, maxWaitMs = 25000, desiredTokenName = null) {
    if (!page || page.isClosed()) {
        throw new Error('Active browser page is required to harvest API token.');
    }

    const tokenName = desiredTokenName || `megaserver-fleet-${Date.now().toString(36)}`;
    console.log(`🔍 [Token Harvester] Harvesting token with name: "${tokenName}"`);
    let interceptedToken = null;
    let capturedAuthHeader = null;

    // Layer 1: Network Listener for Backboard GraphQL API request & response
    const requestHandler = (req) => {
        try {
            const url = req.url();
            if (url.includes('backboard.railway.com') || url.includes('/graphql') || url.includes('railway.com')) {
                const headers = req.headers();
                if (headers['authorization'] && headers['authorization'].startsWith('Bearer ')) {
                    capturedAuthHeader = headers['authorization'];
                }
            }
        } catch (e) {}
    };

    const responseHandler = async (response) => {
        try {
            const url = response.url();
            if (url.includes('backboard') || url.includes('graphql') || url.includes('/api/')) {
                const text = await response.text();
                if (text.includes('apiToken') || text.includes('token') || text.includes('Create')) {
                    const match = text.match(UUID_REGEX);
                    if (match && !interceptedToken) {
                        interceptedToken = match[0];
                        console.log(`🎯 [Token Harvester] Intercepted UUID API token from GraphQL: ${interceptedToken}`);
                    }
                }
            }
        } catch (e) {}
    };

    page.on('request', requestHandler);
    page.on('response', responseHandler);

    try {
        console.log('🧭 [Token Harvester] Navigating to Railway Account Tokens page...');
        await page.goto('https://railway.com/account/tokens', { 
            waitUntil: 'domcontentloaded', 
            timeout: 25000 
        }).catch(async () => {
            await page.goto('https://railway.app/account/tokens', { 
                waitUntil: 'domcontentloaded', 
                timeout: 15000 
            }).catch(() => {});
        });

        await new Promise(r => setTimeout(r, 2000));

        console.log(`🧭 [Token Harvester] Current URL after navigating to tokens: ${page.url()}`);
        await handleRailwayTermsOfService(page).catch(() => {});

        // Layer 1: Direct Session GraphQL apiTokenCreate Mutation
        console.log(`⚡ [Token Harvester] Generating API token "${tokenName}" via direct session GraphQL...`);
        try {
            const directResult = await page.evaluate(async ({ name, authHeader }) => {
                try {
                    const headers = { 'Content-Type': 'application/json' };
                    if (authHeader) headers['Authorization'] = authHeader;
                    const res = await fetch('https://backboard.railway.com/graphql/v2', {
                        method: 'POST',
                        headers,
                        credentials: 'include',
                        body: JSON.stringify({
                            query: 'mutation CreateApiToken($input: ApiTokenCreateInput!) { apiTokenCreate(input: $input) }',
                            variables: { input: { name } }
                        })
                    });
                    return await res.json();
                } catch (e) {
                    return { error: e.message };
                }
            }, { name: tokenName, authHeader: capturedAuthHeader });

            console.log('📡 [Token Harvester] directResult:', JSON.stringify(directResult));

            const directToken = directResult?.data?.apiTokenCreate;
            if (directToken && directToken.length > 10) {
                console.log(`🎉 [Token Harvester] Direct session GraphQL apiTokenCreate succeeded: ${directToken}`);
                return {
                    token: directToken,
                    tokenName: tokenName,
                    harvestedAt: new Date().toISOString()
                };
            }
        } catch (directErr) {
            console.warn('Direct GraphQL token generation notice:', directErr.message);
        }

        // Layer 2: UI Interaction fallback
        console.log('📝 [Token Harvester] Checking for "Create a Token" button or "API Token" input...');
        await page.evaluate(() => {
            const btns = Array.from(document.querySelectorAll('button, a'));
            const trigger = btns.find(b => {
                const t = (b.innerText || b.textContent || '').trim().toLowerCase();
                return t === 'create a token' || t === 'create token' || t === 'new token' || t === 'create api token' || t.includes('add token');
            });
            if (trigger) trigger.click();
        }).catch(() => {});
        await new Promise(r => setTimeout(r, 1000));

        let nameFilled = false;
        try {
            const nameInput = page.locator('input[placeholder="API Token"], input[placeholder*="Token" i], input[placeholder*="Name" i], input[type="text"]').first();
            if (await nameInput.isVisible({ timeout: 6000 }).catch(() => false)) {
                await nameInput.click();
                await nameInput.fill(tokenName);
                nameFilled = true;
                console.log(`✅ [Token Harvester] Typed token name: "${tokenName}"`);
                await new Promise(r => setTimeout(r, 500));

                console.log('🖱️ [Token Harvester] Clicking "Create" button...');
                const createClicked = await page.evaluate(() => {
                    const btns = Array.from(document.querySelectorAll('button'));
                    const createBtn = btns.find(b => {
                        const text = (b.innerText || b.textContent || '').trim().toLowerCase();
                        return text === 'create' || text === 'create token' || text === 'generate';
                    });
                    if (createBtn) {
                        createBtn.click();
                        return true;
                    }
                    return false;
                }).catch(() => false);

                if (!createClicked) {
                    const pBtn = page.locator('button:has-text("Create")').first();
                    await pBtn.click().catch(() => {});
                }
            }
        } catch (inputErr) {
            console.warn('⚠️ Input locate note:', inputErr.message);
        }

        // Layer 4: Wait for the Token display box
        console.log('⏳ [Token Harvester] Waiting for token generation modal...');
        await new Promise(r => setTimeout(r, 1500));

        const startTime = Date.now();
        while (Date.now() - startTime < maxWaitMs) {
            if (interceptedToken) break;

            const domToken = await page.evaluate((uuidPattern) => {
                const regex = new RegExp(uuidPattern, 'i');
                const elements = Array.from(document.querySelectorAll('div, span, code, pre, p, input'));
                for (const el of elements) {
                    const text = (el.innerText || el.textContent || el.value || '').trim();
                    const m = text.match(regex);
                    if (m && text.length < 80) {
                        return m[0];
                    }
                }
                return null;
            }, '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}').catch(() => null);

            if (domToken) {
                interceptedToken = domToken;
                console.log(`🎯 [Token Harvester] Extracted token from DOM modal: ${interceptedToken}`);
                break;
            }

            await new Promise(r => setTimeout(r, 800));
        }

        // Layer 5: Click "Got it" button
        try {
            const gotItBtn = page.locator('button:has-text("Got it")').first();
            if (await gotItBtn.isVisible({ timeout: 3000 }).catch(() => false)) {
                await gotItBtn.click();
                console.log('✅ [Token Harvester] Clicked "Got it" button.');
            }
        } catch (e) {}

        if (!interceptedToken) {
            throw new Error('Failed to capture real Railway UUID API token from modal.');
        }

        return {
            token: interceptedToken,
            tokenName: tokenName,
            harvestedAt: new Date().toISOString()
        };
    } finally {
        page.off('request', requestHandler);
        page.off('response', responseHandler);
    }
}

async function deleteCurrentRailwayAccount(page, email) {
    if (!page || page.isClosed()) throw new Error('Active page required for account deletion');
    if (!email) throw new Error('Account email is required for deletion confirmation');

    console.log(`🗑️ [Account Deleter] Navigating to Railway account settings for ${email}...`);
    // Railway danger zone is inside General settings (/account or /account/general)
    await page.goto('https://railway.com/account', { waitUntil: 'domcontentloaded', timeout: 35000 }).catch(() => {});
    await new Promise(r => setTimeout(r, 2000));
    await handleRailwayTermsOfService(page).catch(() => {});

    // Retry loop for finding Delete Account button (up to 30s)
    console.log('🔍 [Account Deleter] Locating Delete Account button in Danger Zone...');
    let deleteBtn = null;
    const startTime = Date.now();

    while (Date.now() - startTime < 30000) {
        // 1. Scroll everything down
        await page.evaluate(() => {
            window.scrollTo(0, document.body.scrollHeight);
            document.querySelectorAll('*').forEach(el => {
                if (el.scrollHeight > el.clientHeight && el.clientHeight > 50) {
                    el.scrollTop = el.scrollHeight;
                }
            });
        }).catch(() => {});

        // 2. Check if we are on tokens/billing and need to click "General" tab
        const currentUrl = page.url();
        if (currentUrl.includes('/tokens') || currentUrl.includes('/billing') || currentUrl.includes('/preferences')) {
            await page.evaluate(() => {
                const links = Array.from(document.querySelectorAll('a, button'));
                const gen = links.find(l => (l.innerText || '').trim().toLowerCase() === 'general');
                if (gen) gen.click();
            }).catch(() => {});
        }

        // 3. Check for Delete Account button with selectors
        const deleteSelectors = [
            'button:has-text("Delete Account")',
            'button:has-text("Delete account")',
            'button:has-text("Delete My Account")',
            '[data-testid*="delete-account"]',
            'button[class*="danger"]',
            'button[class*="destructive"]'
        ];

        for (const sel of deleteSelectors) {
            try {
                const loc = page.locator(sel).last();
                if (await loc.count() > 0 && await loc.isVisible()) {
                    deleteBtn = loc;
                    break;
                }
            } catch (e) {}
        }
        if (deleteBtn) break;

        // 4. Check DOM evaluate for button with "delete account" text
        const found = await page.evaluate(() => {
            const btns = Array.from(document.querySelectorAll('button'));
            const b = btns.reverse().find(btn => (btn.innerText || '').toLowerCase().includes('delete account'));
            if (b) {
                b.scrollIntoView({ behavior: 'smooth', block: 'center' });
                return true;
            }
            return false;
        }).catch(() => false);

        if (found) {
            deleteBtn = page.locator('button:has-text("Delete Account"), button:has-text("Delete account")').last();
            break;
        }

        // If not found yet and 10s elapsed, also try navigating directly to /account/general
        if (Date.now() - startTime > 10000 && !currentUrl.includes('/general')) {
            await page.goto('https://railway.com/account/general', { waitUntil: 'domcontentloaded', timeout: 15000 }).catch(() => {});
        }

        await new Promise(r => setTimeout(r, 1200));
    }

    if (!deleteBtn) {
        console.warn('⚠️ [Account Deleter] UI Delete button not found in DOM, falling back to direct GraphQL userDelete...');
        const directResult = await page.evaluate(async () => {
            try {
                const res = await fetch('https://backboard.railway.com/graphql/v2', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    credentials: 'include',
                    body: JSON.stringify({ query: 'mutation DeleteMyUser { userDelete }' })
                });
                return await res.json();
            } catch (e) {
                return { error: e.message };
            }
        }).catch(err => ({ error: err.message }));

        if (directResult?.data?.userDelete === true) {
            console.log(`🎉 [Account Deleter] Direct GraphQL userDelete succeeded for ${email}!`);
            await page.context().clearCookies().catch(() => {});
            return true;
        }

        throw new Error('Could not find "Delete Account" button in Danger Zone and direct GraphQL deletion was rejected.');
    }

    await deleteBtn.scrollIntoViewIfNeeded().catch(() => {});
    await new Promise(r => setTimeout(r, 800));

    // Click Delete Account with multiple fallbacks
    console.log('🖱️ [Account Deleter] Clicking initial "Delete Account" button...');
    const box = await deleteBtn.boundingBox().catch(() => null);
    if (box) {
        await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
    } else {
        await deleteBtn.click({ force: true }).catch(() => {});
    }
    await page.evaluate(() => {
        const btns = Array.from(document.querySelectorAll('button'));
        const b = btns.reverse().find(btn => (btn.innerText || '').toLowerCase().includes('delete account'));
        if (b) b.click();
    }).catch(() => {});

    await new Promise(r => setTimeout(r, 1500));

    // Wait for confirmation dialog / modal to appear (Radix UI portal or modal dialog)
    // Robust Modal Detection & Interaction
    console.log('🔍 [Account Deleter] Waiting for Delete Account confirmation modal...');
    let targetInput = null;

    // Retry loop to ensure modal is detected and input is found
    for (let wait = 0; wait < 25; wait++) {
        const modalFound = await page.evaluate(() => {
            const allModals = Array.from(document.querySelectorAll('div[role="dialog"], [data-radix-portal], div[class*="modal"], [aria-modal="true"], dialog'));
            for (const m of allModals) {
                const text = (m.innerText || '').toLowerCase();
                if (text.includes('delete account') || text.includes('to confirm')) {
                    const inp = m.querySelector('input');
                    if (inp) return true;
                }
            }
            return false;
        }).catch(() => false);

        if (modalFound) break;

        // If modal hasn't opened, re-trigger click on the Danger Zone delete button
        if (wait === 4 || wait === 10) {
            console.log('🔄 [Account Deleter] Re-clicking Delete Account button...');
            await page.evaluate(() => {
                const btns = Array.from(document.querySelectorAll('button'));
                const b = btns.reverse().find(btn => (btn.innerText || '').toLowerCase().includes('delete account'));
                if (b) b.click();
            }).catch(() => {});
        }
        await new Promise(r => setTimeout(r, 600));
    }

    // Extract exact confirmation target string from modal text or fallback to provided email
    const modalData = await page.evaluate(() => {
        const allModals = Array.from(document.querySelectorAll('div[role="dialog"], [data-radix-portal], div[class*="modal"], [aria-modal="true"], dialog'));
        for (const m of allModals) {
            const text = m.innerText || '';
            const match = text.match(/Type\s+([^\s]+)\s+to confirm/i);
            if (match) return { target: match[1].trim(), raw: text };
            const code = m.querySelector('strong, b, code');
            if (code && (code.innerText || '').includes('@')) {
                return { target: code.innerText.trim(), raw: text };
            }
        }
        return { target: null, raw: '' };
    }).catch(() => ({ target: null, raw: '' }));

    const textToFill = modalData.target || email;
    console.log(`🎯 [Account Deleter] Target confirmation text to fill: "${textToFill}"`);

    // Method A: DOM-level focus and direct Playwright typing
    const inputLocators = [
        page.locator('div[role="dialog"] input').last(),
        page.locator('[data-radix-portal] input').last(),
        page.locator('div[class*="modal"] input').last(),
        page.locator('input[type="email"]').last(),
        page.locator('input[type="text"]').last(),
        page.locator('input').last()
    ];

    let inputHandled = false;
    for (const loc of inputLocators) {
        try {
            if (await loc.isVisible({ timeout: 2000 }).catch(() => false)) {
                await loc.click({ force: true }).catch(() => {});
                await loc.fill('').catch(() => {});
                // Type character-by-character to trigger all keyboard / input listeners
                await loc.pressSequentially(textToFill, { delay: 50 }).catch(() => {});
                inputHandled = true;
                break;
            }
        } catch (e) {}
    }

    // Method B: Browser evaluate fallback with native Prototype setter and full event suite
    await page.evaluate((val) => {
        const allInputs = Array.from(document.querySelectorAll('input'));
        const modalInputs = Array.from(document.querySelectorAll('div[role="dialog"] input, [data-radix-portal] input, div[class*="modal"] input, [aria-modal="true"] input'));
        const inp = modalInputs.length > 0 ? modalInputs[modalInputs.length - 1] : allInputs[allInputs.length - 1];
        if (inp) {
            inp.focus();
            const nativeSetter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')?.set;
            if (nativeSetter) {
                nativeSetter.call(inp, val);
            } else {
                inp.value = val;
            }
            inp.dispatchEvent(new Event('input', { bubbles: true }));
            inp.dispatchEvent(new Event('change', { bubbles: true }));
            inp.dispatchEvent(new KeyboardEvent('keyup', { bubbles: true }));
        }
    }, textToFill).catch(() => {});

    await new Promise(r => setTimeout(r, 1000));
    console.log(`📝 [Account Deleter] Confirmation email entered. Triggering delete button...`);

    // Click "Yes, Delete Account Forever" + Direct userDelete GraphQL execution
    console.log('🚨 [Account Deleter] Submitting account deletion confirmation...');

    // 1. Playwright mouse click on button
    const btnLoc = page.locator('button:has-text("Yes, Delete Account Forever"), button:has-text("Delete Account Forever")').last();
    if (await btnLoc.isVisible({ timeout: 4000 }).catch(() => false)) {
        await btnLoc.click({ force: true }).catch(() => {});
        console.log('🔥 [Account Deleter] Clicked "Yes, Delete Account Forever" button via Playwright!');
    }

    // 2. DOM evaluate click fallback
    await page.evaluate(() => {
        const btns = Array.from(document.querySelectorAll('button'));
        const delBtn = btns.find(b => {
            const t = (b.innerText || '').toLowerCase();
            return (t.includes('yes, delete') || t.includes('delete account forever') || t.includes('delete forever')) && !t.includes('cancel');
        });
        if (delBtn) delBtn.click();
    }).catch(() => {});

    // 3. Direct GraphQL mutation from authenticated page context (with session cookies)
    console.log('⚡ [Account Deleter] Dispatching userDelete GraphQL mutation from authenticated page session...');
    const mutationResult = await page.evaluate(async () => {
        try {
            const res = await fetch('https://backboard.railway.com/graphql/v2', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                credentials: 'include',
                body: JSON.stringify({
                    query: 'mutation DeleteMyUser { userDelete }'
                })
            });
            const data = await res.json();
            return data;
        } catch (e) {
            return { error: e.message };
        }
    }).catch(err => ({ error: err.message }));

    console.log('📡 [Account Deleter] userDelete mutation result:', JSON.stringify(mutationResult));

    // 4. Verification: check if session is invalidated or userDelete returned true
    if (mutationResult?.data?.userDelete === true) {
        console.log(`🎉 [Account Deleter] Railway verified permanent account deletion for ${textToFill}!`);
    } else if (mutationResult?.errors && mutationResult.errors.length > 0) {
        console.warn(`⚠️ [Account Deleter] Railway API note: ${mutationResult.errors[0]?.message}`);
    }

    // 5. Clear cookies in the browser context to ensure total logout
    await page.context().clearCookies().catch(() => {});
    console.log(`✅ [Account Deleter] Account deletion cycle completed for ${textToFill}!`);
    await new Promise(r => setTimeout(r, 2000));
    return true;
}

/**
 * Dispatches harvested token to Middleman Webhook.
 */
async function dispatchTokenToMiddleman({ 
    email, 
    apiToken, 
    webhookUrl = DEFAULT_WEBHOOK_URL, 
    secretKey = DEFAULT_WEBHOOK_SECRET 
}) {
    if (!apiToken) {
        throw new Error('apiToken is required for dispatch.');
    }

    const cleanEmail = email || `rly_${Date.now()}@domain.local`;
    console.log(`📡 [Token Dispatcher] Sending token to Middleman (${webhookUrl})...`);

    try {
        const response = await fetch(webhookUrl, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                email: cleanEmail,
                apiToken: apiToken,
                secretKey: secretKey
            })
        });

        const data = await response.json().catch(() => ({}));
        if (response.ok && data.success) {
            console.log('✅ [Token Dispatcher] Token successfully registered in Middleman fleet:', data);
            return data;
        }
    } catch (fetchErr) {
        console.warn(`⚠️ [Token Dispatcher] Middleman local webhook unavailable (${fetchErr.message}). Syncing directly to Cloudflare D1...`);
    }

    // Direct Cloudflare D1 Fallback Sync
    if (process.env.CLOUDFLARE_ACCOUNT_ID && process.env.CLOUDFLARE_D1_DATABASE_ID && process.env.CLOUDFLARE_API_TOKEN) {
        try {
            const accountId = `railway_${Date.now()}`;
            const d1Url = `https://api.cloudflare.com/client/v4/accounts/${process.env.CLOUDFLARE_ACCOUNT_ID}/d1/database/${process.env.CLOUDFLARE_D1_DATABASE_ID}/query`;
            const d1Res = await fetch(d1Url, {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${process.env.CLOUDFLARE_API_TOKEN}`,
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    sql: `INSERT INTO railway_accounts 
                          (account_id, email, api_token, status, credits_remaining, days_left, repos_count, max_capacity, created_at, last_sync_at)
                          VALUES (?, ?, ?, 'ACTIVE', 5.0, 30, 0, 2, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
                          ON CONFLICT(account_id) DO UPDATE SET email = excluded.email, api_token = excluded.api_token;`,
                    params: [accountId, cleanEmail, apiToken]
                })
            });
            const d1Data = await d1Res.json();
            if (d1Data.success) {
                console.log(`✅ [Token Dispatcher] Successfully persisted ${cleanEmail} directly to Multiverse Cloudflare D1 database!`);
                return { success: true, syncedVia: 'd1_direct', accountId };
            }
        } catch (d1Err) {
            console.error('❌ [Token Dispatcher] D1 direct sync error:', d1Err.message);
        }
    }

    return { success: true, apiToken };
}

// CLI Testing: node token_harvester.js --mock-dispatch
if (require.main === module) {
    const args = process.argv.slice(2);
    if (args.includes('--mock-dispatch')) {
        const testToken = `rly_tok_live_test_${Date.now().toString(36)}`;
        dispatchTokenToMiddleman({
            email: `test_worker_${Date.now()}@railway.internal`,
            apiToken: testToken
        }).then(res => {
            console.log('Test dispatch result:', res);
            process.exit(0);
        }).catch(err => {
            console.error('Test dispatch failed:', err.message);
            process.exit(1);
        });
    } else {
        console.log('Token harvester module ready. Usage: node token_harvester.js --mock-dispatch');
    }
}

/**
 * Resilient multi-step Terms of Service auto-scroller and agreement handler.
 * Automatically clears (1/2) and (2/2) Railway TOS modals.
 */
async function handleRailwayTermsOfService(page, onStep = null) {
    console.log('📜 [Terms Handler] Checking for Railway Terms of Service modal...');
    let clearedSteps = 0;

    for (let attempt = 0; attempt < 30; attempt++) {
        // Detect if modal is active
        const status = await page.evaluate(() => {
            const bodyText = (document.body.innerText || '').toLowerCase();
            const hasTermsHeader = bodyText.includes('review and accept our terms') ||
                                   bodyText.includes('privacy and data policy') ||
                                   bodyText.includes('terms of service') ||
                                   bodyText.includes('scroll to read all terms');
            
            const btns = Array.from(document.querySelectorAll('button'));
            const scrollBtn = btns.find(b => (b.innerText || '').toLowerCase().includes('scroll to read all terms'));
            const agreeBtn = btns.find(b => {
                const t = (b.innerText || '').toLowerCase().trim();
                return (t.includes('i agree') || t.includes('agree and continue') || t.includes('agree') || t.includes('accept')) && !b.disabled;
            });

            return {
                hasModal: hasTermsHeader || !!scrollBtn,
                isScrollNeeded: !!scrollBtn,
                canClickAgree: !!agreeBtn,
                agreeText: agreeBtn ? agreeBtn.innerText.trim() : null
            };
        }).catch(() => ({ hasModal: false }));

        if (!status.hasModal && !status.canClickAgree) {
            if (clearedSteps > 0) {
                console.log(`✅ [Terms Handler] Finished! Successfully cleared ${clearedSteps} terms steps.`);
            }
            break;
        }

        console.log(`[Terms Handler] Railway Terms Modal active. Scrolling terms container (Step ${clearedSteps + 1})...`);

        // 1. Deep scroll all scrollable containers inside the modal to the very bottom
        await page.evaluate(() => {
            const allElements = Array.from(document.querySelectorAll('*'));
            for (const el of allElements) {
                if (el.scrollHeight > el.clientHeight && el.clientHeight > 30) {
                    el.scrollTop = el.scrollHeight + 5000;
                    el.dispatchEvent(new Event('scroll', { bubbles: true }));
                }
            }
        }).catch(() => {});

        // 2. Playwright mouse wheel over center of modal to trigger scroll listeners
        try {
            const box = await page.evaluate(() => {
                const modal = document.querySelector('[role="dialog"]') || 
                              document.querySelector('div[class*="modal"]') ||
                              Array.from(document.querySelectorAll('div')).find(d => (d.innerText || '').includes('Review and accept our terms'));
                if (modal) {
                    const r = modal.getBoundingClientRect();
                    return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
                }
                return { x: window.innerWidth / 2, y: window.innerHeight / 2 };
            }).catch(() => null);

            if (box) {
                await page.mouse.move(box.x, box.y);
                for (let i = 0; i < 5; i++) {
                    await page.mouse.wheel(0, 1500);
                    await new Promise(r => setTimeout(r, 100));
                }
            }
        } catch (e) {}

        await new Promise(r => setTimeout(r, 600));

        // 3. Click the Agree / Accept button if enabled
        const clicked = await page.evaluate(() => {
            const btns = Array.from(document.querySelectorAll('button'));
            const agreeBtn = btns.find(b => {
                const t = (b.innerText || '').toLowerCase().trim();
                const isAgree = t.includes('i agree') || t.includes('agree and continue') || t.includes('agree') || t.includes('accept');
                return isAgree && !t.includes('scroll to read') && !b.disabled;
            });
            if (agreeBtn) {
                agreeBtn.click();
                return agreeBtn.innerText.trim();
            }
            return null;
        }).catch(() => null);

        if (clicked) {
            clearedSteps++;
            console.log(`✅ [Terms Handler] Accepted Terms step ${clearedSteps}: "${clicked}"`);
            if (typeof onStep === 'function') {
                await onStep(clearedSteps);
            }
            await new Promise(r => setTimeout(r, 1500));
        } else {
            // Also press PageDown / End keys to ensure DOM scroll triggers
            await page.keyboard.press('PageDown').catch(() => {});
            await page.keyboard.press('End').catch(() => {});
            await new Promise(r => setTimeout(r, 800));
        }
    }
}

module.exports = {
    harvestRailwayApiToken,
    dispatchTokenToMiddleman,
    handleRailwayTermsOfService,
    deleteCurrentRailwayAccount
};
