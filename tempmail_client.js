/**
 * MailU (mailu.site) Real Temp Mail & OTP Client
 * Uses the official live MailU public API:
 *   - POST /api/mailbox -> creates inbox & returns session token
 *   - GET /api/messages -> retrieves inbox message list using Bearer token
 *   - GET /api/messages/:id -> retrieves full email body and extracts 6-digit OTP
 */

require('dotenv').config();
const fs = require('fs');
const path = require('path');

const MAILU_BASE_URL = 'https://mailu.site/api';
const TOKEN_CACHE_FILE = path.resolve(__dirname, '.mailu_tokens.json');

// Memory map of inbox address -> auth token
const inboxTokenMap = new Map();

function loadCachedTokens() {
    try {
        if (fs.existsSync(TOKEN_CACHE_FILE)) {
            const data = JSON.parse(fs.readFileSync(TOKEN_CACHE_FILE, 'utf-8'));
            for (const [addr, tok] of Object.entries(data)) {
                inboxTokenMap.set(addr.toLowerCase(), tok);
            }
        }
    } catch (e) {}
}

function saveCachedTokens() {
    try {
        const obj = {};
        for (const [addr, tok] of inboxTokenMap.entries()) {
            obj[addr] = tok;
        }
        fs.writeFileSync(TOKEN_CACHE_FILE, JSON.stringify(obj, null, 2), 'utf-8');
    } catch (e) {}
}

loadCachedTokens();

/**
 * Creates a real, live temporary mailbox on mailu.site
 * @returns {Promise<string>} Real live email address e.g. lunarvector45@mailu.site
 */
async function generateTempEmail() {
    try {
        console.log('[TempMail] Registering fresh disposable inbox on mailu.site...');
        const res = await fetch(`${MAILU_BASE_URL}/mailbox`, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({})
        });

        if (res.ok) {
            const data = await res.json();
            if (data.address && data.token) {
                const cleanAddr = data.address.trim().toLowerCase();
                inboxTokenMap.set(cleanAddr, data.token);
                saveCachedTokens();
                console.log(`✅ [TempMail] Successfully created live inbox: ${cleanAddr}`);
                return cleanAddr;
            }
        }
        throw new Error(`Failed to create mailbox: ${res.status}`);
    } catch (e) {
        console.error('⚠️ [TempMail] MailU live creation error, falling back:', e.message);
        // Fallback random email
        const fallback = `user${Math.floor(10000 + Math.random() * 89999)}@mailu.site`;
        return fallback;
    }
}

/**
 * Polls for OTP from the live mailu.site messages
 * @param {string} inbox - Target email address (e.g. user@mailu.site)
 * @param {number} timeout - Polling timeout in seconds (default: 45)
 * @returns {Promise<string>} 6-digit OTP code
 */
/**
 * Ensures a mailbox is registered, active, and permanent on mailu.site v1 API
 * Works for ANY username (even 15-30 days old) with zero drop!
 * @param {string} cleanInbox - Email address (e.g. zendelta10@mailu.site)
 * @returns {Promise<string|null>} Active Bearer token
 */
async function ensureMailbox(cleanInbox) {
    const username = cleanInbox.split('@')[0];
    try {
        const res = await fetch(`https://mailu.site/api/v1/inbox`, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ username })
        });
        if (res.ok) {
            const json = await res.json();
            if (json.data && json.data.token) {
                inboxTokenMap.set(cleanInbox, json.data.token);
                saveCachedTokens();
                return json.data.token;
            }
        }
    } catch (e) {
        console.warn(`[TempMail] ensureMailbox warning for ${cleanInbox}:`, e.message);
    }
    return inboxTokenMap.get(cleanInbox) || null;
}

/**
 * Polls for OTP from the live mailu.site messages
 * Uses the new v1 Instant OTP API with automatic mailbox revival
 * @param {string} inbox - Target email address (e.g. user@mailu.site)
 * @param {number} timeout - Polling timeout in seconds (default: 45)
 * @returns {Promise<string>} 6-digit OTP code
 */
async function fetchRawOtp(inbox, timeout = 45) {
    if (!inbox) throw new Error('Inbox parameter is required');
    const cleanInbox = inbox.trim().toLowerCase();
    
    // 1. Ensure mailbox is active/revived on mailu.site v1 API
    let token = await ensureMailbox(cleanInbox);
    if (!token) {
        token = inboxTokenMap.get(cleanInbox);
    }

    console.log(`[TempMail] Live polling messages for ${cleanInbox} (timeout: ${timeout}s)...`);
    const startTime = Date.now();
    const maxDuration = timeout * 1000;

    while (Date.now() - startTime < maxDuration) {
        // Try v1 instant OTP endpoint
        if (token) {
            try {
                const otpRes = await fetch(`https://mailu.site/api/v1/inbox/otp?timeout=2`, {
                    headers: { 'Authorization': `Bearer ${token}` }
                });
                if (otpRes.ok) {
                    const otpData = await otpRes.json();
                    if (otpData.success && otpData.otp && /^\d{6}$/.test(String(otpData.otp).trim())) {
                        const code = String(otpData.otp).trim();
                        console.log(`✅ [TempMail] Successfully extracted OTP via v1 API: ${code}`);
                        return code;
                    }
                } else if (otpRes.status === 401) {
                    console.warn(`⚠️ [TempMail] Token unauthorized, re-ensuring mailbox for ${cleanInbox}...`);
                    token = await ensureMailbox(cleanInbox);
                }
            } catch (err) {
                // Network tick catch
            }
        }

        // Try raw messages check as fallback
        if (token) {
            try {
                const listRes = await fetch(`${MAILU_BASE_URL}/messages`, {
                    headers: { 'Authorization': `Bearer ${token}` }
                });
                if (listRes.ok) {
                    const listData = await listRes.json();
                    const messages = Array.isArray(listData.messages) ? listData.messages : [];
                    for (const msg of messages) {
                        try {
                            const detailRes = await fetch(`${MAILU_BASE_URL}/messages/${msg.id}`, {
                                headers: { 'Authorization': `Bearer ${token}` }
                            });
                            if (detailRes.ok) {
                                const detail = await detailRes.json();
                                const fullText = `${detail.subject || ''} ${detail.snippet || ''} ${detail.text_body || ''} ${detail.html_body || ''}`;
                                const match = fullText.match(/\b\d{6}\b/);
                                if (match) {
                                    console.log(`✅ [TempMail] Successfully extracted OTP from message: ${match[0]}`);
                                    return match[0];
                                }
                            }
                        } catch (detailErr) {}
                    }
                }
            } catch (pollErr) {}
        }

        await new Promise(r => setTimeout(r, 2000));
    }

    throw new Error(`Timeout waiting for OTP on ${cleanInbox}`);
}

module.exports = {
    generateTempEmail,
    fetchRawOtp,
    ensureMailbox,
    inboxTokenMap
};


