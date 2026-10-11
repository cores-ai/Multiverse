/**
 * Temp Mail Service Integration for Mailu.site
 * Provides automatic inbox generation and raw OTP extraction
 */

const DEFAULT_MAILU_DOMAIN = process.env.MAILU_DOMAIN || 'mailu.site';

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

export function generateTempEmail(_prefix = '', domain = DEFAULT_MAILU_DOMAIN) {
  const baseName = REAL_USERNAMES[Math.floor(Math.random() * REAL_USERNAMES.length)];
  const randomNum = Math.floor(100 + Math.random() * 98900);
  const username = `${baseName}${randomNum}`.toLowerCase().replace(/[^a-z0-9]/g, '');
  const inbox = `${username}@${domain}`;
  return {
    inbox,
    username,
    domain,
    createdAt: new Date().toISOString()
  };
}

function extractOtpFromText(text) {
  if (!text) return null;
  const clean = String(text).replace(/<style[\s\S]*?<\/style>/gi, '').replace(/#[0-9a-fA-F]{3,8}/g, '');
  const match = clean.match(/\b([0-9]{6})\b/);
  return match ? match[1] : null;
}

export async function fetchRawOtp(inbox, timeout = 8) {
  if (!inbox) {
    throw new Error('Inbox parameter is required to fetch OTP');
  }

  const cleanInbox = inbox.trim().toLowerCase();
  const username = cleanInbox.split('@')[0];

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
    console.warn('Mailu revive notice:', e.message);
  }

  if (token) {
    // 1. Check instant OTP endpoint
    try {
      const otpRes = await fetch(`https://mailu.site/api/v1/inbox/otp?timeout=${Math.min(timeout, 12)}`, {
        headers: { 'Authorization': `Bearer ${token}` }
      });
      if (otpRes.ok) {
        const otpData = await otpRes.json();
        const foundOtp = otpData.otp || otpData.code;
        if (foundOtp) {
          return {
            success: true,
            inbox: cleanInbox,
            otp: String(foundOtp).trim(),
            receivedAt: new Date().toISOString()
          };
        }
      }
    } catch (e) {}

    // 2. Check inbox messages directly and scan body for 6-digit verification code
    try {
      const msgRes = await fetch('https://mailu.site/api/v1/inbox/messages', {
        headers: { 'Authorization': `Bearer ${token}` }
      });
      if (msgRes.ok) {
        const msgData = await msgRes.json();
        const messages = msgData.messages || msgData.data || [];
        for (const msg of messages) {
          const body = msg.body || msg.text || msg.html || msg.subject || '';
          const candidate = extractOtpFromText(body);
          if (candidate) {
            return {
              success: true,
              inbox: cleanInbox,
              otp: candidate,
              receivedAt: msg.date || new Date().toISOString()
            };
          }
        }
      }
    } catch (e) {}
  }

  // Graceful waiting state - zero crashes, zero 401s
  return {
    success: false,
    waiting: true,
    inbox: cleanInbox,
    otp: null,
    message: 'Waiting for OTP email...'
  };
}
