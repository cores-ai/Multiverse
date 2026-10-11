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

function generateTempEmail(_prefix = '') {
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

async function fetchRawOtp(inbox, timeout = 30) {
    if (!inbox) throw new Error('inbox is required to fetch OTP');
    const cleanInbox = inbox.trim().toLowerCase();
    const username = cleanInbox.split('@')[0];

    console.log(`[TempMail] Polling OTP for ${cleanInbox} (timeout: ${timeout}s)...`);

    let token = null;
    try {
        const reviveRes = await fetch('https://mailu.site/api/v1/inbox', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ username })
        });
        if (reviveRes.ok) {
            const reviveData = await reviveRes.json();
            token = reviveData.data?.token || null;
        }
    } catch (e) {
        console.warn('Mailu revive error:', e.message);
    }

    if (token) {
        // Check instant OTP endpoint
        try {
            const otpRes = await fetch(`https://mailu.site/api/v1/inbox/otp?timeout=${Math.min(timeout, 25)}`, {
                headers: { 'Authorization': `Bearer ${token}` }
            });
            if (otpRes.ok) {
                const otpData = await otpRes.json();
                const foundOtp = otpData.otp || otpData.code;
                if (foundOtp) {
                    console.log(`✅ [TempMail] Instant OTP received: ${foundOtp}`);
                    return String(foundOtp).trim();
                }
            }
        } catch (e) {}

        // Check messages fallback
        try {
            const msgRes = await fetch('https://mailu.site/api/v1/inbox/messages', {
                headers: { 'Authorization': `Bearer ${token}` }
            });
            if (msgRes.ok) {
                const msgData = await msgRes.json();
                const messages = msgData.messages || msgData.data || [];
                for (const msg of messages) {
                    const candidate = extractOtpFromMessage(msg.body || msg.text || msg.html || msg.subject || '');
                    if (candidate) {
                        console.log(`✅ [TempMail] Extracted OTP from message body: ${candidate}`);
                        return candidate;
                    }
                }
            }
        } catch (e) {}
    }

    throw new Error(`No OTP received for ${cleanInbox} within ${timeout}s window.`);
}

module.exports = {
    generateTempEmail,
    fetchRawOtp
};
