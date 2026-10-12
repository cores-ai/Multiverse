/**
 * Mailu.site Temp Mail & OTP Client for Railway Worker Engine
 */

require('dotenv').config();

const DOMAIN = process.env.MAILU_DOMAIN || 'mailu.site';

const REAL_USERNAMES = [
  'alexander', 'oliver', 'lucas', 'henry', 'ethan', 'daniel', 'mason', 'connor', 'nathan',
  'sophia', 'emma', 'olivia', 'amelia', 'charlotte', 'harper', 'mia', 'evelyn', 'isabella',
  'aarav', 'rohan', 'aditya', 'aravind', 'rahul', 'vikram', 'siddharth', 'karan', 'varun',
  'priya', 'ananya', 'kavya', 'diya', 'isha', 'sneha', 'tanvi', 'shreya', 'pooja',
  'mateo', 'carlos', 'diego', 'javier', 'alejandro', 'gabriel', 'nicolas', 'thiago',
  'camila', 'valeria', 'mariana', 'lucia', 'catalina', 'elena', 'fernanda', 'daniela',
  'marcus', 'leon', 'felix', 'moritz', 'jonas', 'lukas', 'elias', 'finn',
  'yuki', 'haruto', 'yuto', 'kaito', 'riku', 'kenji', 'daiki', 'kazuki',
  'omar', 'tariq', 'zayn', 'hamza', 'kareem', 'yusuf', 'bilal', 'samir'
];

const mailboxTokens = new Map();

async function generateTempEmail(_prefix = '') {
    try {
        const res = await fetch('https://mailu.site/api/v1/inbox', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            signal: AbortSignal.timeout(6000)
        });
        if (res.ok) {
            const data = await res.json();
            if (data.success && data.data && data.data.address) {
                const addr = data.data.address.toLowerCase();
                if (data.data.token) {
                    mailboxTokens.set(addr, data.data.token);
                }
                return addr;
            }
        }
    } catch (e) {
        console.warn('[TempMail] Mailu online inbox creation warning:', e.message);
    }

    const baseName = REAL_USERNAMES[Math.floor(Math.random() * REAL_USERNAMES.length)];
    const randomNum = Math.floor(100 + Math.random() * 98900);
    const username = `${baseName}${randomNum}`.toLowerCase().replace(/[^a-z0-9]/g, '');
    return `${username}@${DOMAIN}`;
}

function extractOtpFromMessage(text) {
    if (!text) return null;
    const clean = String(text).replace(/<style[\s\S]*?<\/style>/gi, '').replace(/#[0-9a-fA-F]{3,8}/g, '');
    const match = clean.match(/\b([0-9]{6})\b/);
    return match ? match[1] : null;
}

async function resolveMasterApiKey() {
    if (process.env.MAILU_API_KEY && !process.env.MAILU_API_KEY.includes('YOUR_KEY')) {
        return process.env.MAILU_API_KEY.trim();
    }
    // Auto-fetch from Middleman KV / D1 config bridge if local dev server is active
    try {
        const res = await fetch('http://localhost:3000/api/tempmail?action=config', { signal: AbortSignal.timeout(1500) });
        if (res.ok) {
            const data = await res.json();
            if (data.apiKey) return data.apiKey.trim();
        }
    } catch (e) {}

    return 'ml_live_87ea8bf993c22abe447970e06f0891368925baecbf262129';
}

async function fetchRawOtp(inbox, timeout = 30) {
    if (!inbox) throw new Error('inbox is required to fetch OTP');
    const cleanInbox = inbox.trim().toLowerCase();
    const username = cleanInbox.split('@')[0];

    const apiKey = await resolveMasterApiKey();
    console.log(`[TempMail] Polling OTP for ${cleanInbox} (timeout: ${timeout}s, dual-tier active)...`);

    const startTime = Date.now();
    const endTime = startTime + timeout * 1000;

    let token = mailboxTokens.get(cleanInbox) || null;
    if (!token) {
        try {
            const reviveRes = await fetch('https://mailu.site/api/v1/inbox', {
                method: 'POST',
                headers: { 'content-type': 'application/json' },
                body: JSON.stringify({ address: cleanInbox })
            });
            if (reviveRes.ok) {
                const reviveData = await reviveRes.json();
                token = reviveData.data?.token || null;
                if (token) mailboxTokens.set(cleanInbox, token);
            }
        } catch (e) {}
    }

    let tier1Exhausted = !token;
    let parallelModeAnnounced = false;

    // Helper functions for individual tiers
    async function checkTier1Mailbox() {
        if (!token || tier1Exhausted) return null;
        try {
            // 1a. /inbox/otp endpoint
            const otpRes = await fetch(`https://mailu.site/api/v1/inbox/otp?address=${encodeURIComponent(cleanInbox)}&timeout=2`, {
                headers: { 'Authorization': `Bearer ${token}` }
            });
            if (otpRes.status === 429 || otpRes.status === 401) {
                tier1Exhausted = true;
                return null;
            }
            if (otpRes.ok) {
                const otpData = await otpRes.json();
                const foundOtp = otpData.otp || otpData.code;
                if (foundOtp && /^\d{6}$/.test(String(foundOtp).trim())) {
                    return { source: 'Tier 1 Mailbox OTP', code: String(foundOtp).trim() };
                }
            }
        } catch (e) {}

        try {
            // 1b. /inbox/messages endpoint
            const msgRes = await fetch(`https://mailu.site/api/v1/inbox/messages?address=${encodeURIComponent(cleanInbox)}`, {
                headers: { 'Authorization': `Bearer ${token}` }
            });
            if (msgRes.status === 429 || msgRes.status === 401) {
                tier1Exhausted = true;
                return null;
            }
            if (msgRes.ok) {
                const msgData = await msgRes.json();
                const messages = msgData.messages || msgData.data || [];
                for (const msg of messages) {
                    const candidate = extractOtpFromMessage(msg.body || msg.text || msg.html || msg.subject || '');
                    if (candidate) {
                        return { source: 'Tier 1 Messages', code: candidate };
                    }
                }
            }
        } catch (e) {}

        return null;
    }

    async function checkTier2Master() {
        if (!apiKey) return null;
        try {
            // 2a. Global stream /otps/latest
            const masterUrl = `https://mailu.site/api/v1/otps/latest?recipient=${encodeURIComponent(cleanInbox)}&timeout=2`;
            const masterRes = await fetch(masterUrl, {
                headers: { 'x-api-key': apiKey, 'Accept': 'application/json' }
            });
            if (masterRes.ok) {
                const masterData = await masterRes.json();
                const foundOtp = masterData.otp || masterData.code;
                if (foundOtp && /^\d{6}$/.test(String(foundOtp).trim())) {
                    return { source: 'Tier 2 Master Stream (KV)', code: String(foundOtp).trim() };
                }
            }
        } catch (e) {}

        try {
            // 2b. Master inbox query /master/inbox/:username
            const inboxUrl = `https://mailu.site/api/v1/master/inbox/${encodeURIComponent(username)}`;
            const inboxRes = await fetch(inboxUrl, {
                headers: { 'x-api-key': apiKey, 'Accept': 'application/json' }
            });
            if (inboxRes.ok) {
                const inboxData = await inboxRes.json();
                const messages = inboxData.messages || inboxData.master_inbox || [];
                for (const msg of messages) {
                    const otp = msg.otp || msg.code || extractOtpFromMessage(msg.preview || msg.subject || msg.text_body || msg.html_body || '');
                    if (otp && /^\d{6}$/.test(String(otp).trim())) {
                        return { source: 'Tier 2 Master Inbox (KV)', code: String(otp).trim() };
                    }
                }
            }
        } catch (e) {}

        return null;
    }

    while (Date.now() < endTime) {
        const elapsedSec = (Date.now() - startTime) / 1000;
        const useParallelKv = elapsedSec >= 15 || tier1Exhausted;

        if (useParallelKv && !parallelModeAnnounced) {
            console.log(`⚡ [TempMail] [Dual/Parallel Mode Active] ${tier1Exhausted ? 'Tier 1 quota/limit reached' : '15s elapsed'}. Querying Mailbox + Master KV simultaneously...`);
            parallelModeAnnounced = true;
        }

        if (useParallelKv) {
            // PARALLEL EXECUTION: Query Tier 1 AND Tier 2 concurrently
            const tasks = [checkTier1Mailbox(), checkTier2Master()];
            const results = await Promise.allSettled(tasks);

            for (const res of results) {
                if (res.status === 'fulfilled' && res.value && res.value.code) {
                    console.log(`✅ [TempMail] [${res.value.source}] OTP received: ${res.value.code}`);
                    return res.value.code;
                }
            }
        } else {
            // TIER 1 ONLY (First 15 seconds to preserve master quota)
            const res = await checkTier1Mailbox();
            if (res && res.code) {
                console.log(`✅ [TempMail] [${res.source}] OTP received: ${res.code}`);
                return res.code;
            }
        }

        await new Promise(r => setTimeout(r, 1200));
    }

    throw new Error(`No OTP received for ${cleanInbox} within ${timeout}s window.`);
}

module.exports = {
    generateTempEmail,
    fetchRawOtp
};
