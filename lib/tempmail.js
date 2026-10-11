/**
 * Temp Mail Service Integration for Mailu.site
 * Provides automatic inbox generation and raw OTP extraction
 * Supports both direct mailu.site API and Middleman proxy calls
 */

const DEFAULT_MAILU_API_KEY = process.env.MAILU_API_KEY || 'ml_live_YOUR_KEY_HERE';
const DEFAULT_MAILU_DOMAIN = process.env.MAILU_DOMAIN || 'mailu.site';
const MAILU_BASE_URL = 'https://mailu.site/api/v1';

const REAL_USERNAMES = [
  // Global & English
  'alexander', 'oliver', 'lucas', 'henry', 'ethan', 'daniel', 'mason', 'connor', 'nathan',
  'sophia', 'emma', 'olivia', 'amelia', 'charlotte', 'harper', 'mia', 'evelyn', 'isabella',
  
  // Indian
  'aarav', 'rohan', 'aditya', 'aravind', 'rahul', 'vikram', 'siddharth', 'karan', 'varun',
  'priya', 'ananya', 'kavya', 'diya', 'isha', 'sneha', 'tanvi', 'shreya', 'pooja',
  
  // Hispanic & Latino
  'mateo', 'carlos', 'diego', 'javier', 'alejandro', 'gabriel', 'nicolas', 'thiago',
  'camila', 'valeria', 'mariana', 'lucia', 'catalina', 'elena', 'fernanda', 'daniela',
  
  // European (German, French, Italian, Scandinavian)
  'marcus', 'leon', 'felix', 'moritz', 'jonas', 'lukas', 'elias', 'finn',
  'antoine', 'julien', 'maxime', 'arthur', 'clara', 'chloe', 'camille', 'manon',
  'lorenzo', 'matteo', 'leonardo', 'francesco', 'giulia', 'chiara', 'alessia',
  'johan', 'lars', 'magnus', 'henrik', 'astrid', 'freja', 'ingrid', 'axel',

  // Asian & Japanese
  'yuki', 'haruto', 'yuto', 'kaito', 'riku', 'kenji', 'daiki', 'kazuki',
  'yui', 'hina', 'sakura', 'aoi', 'rin', 'mei', 'nanami', 'ayaka',
  'liwei', 'chen', 'haoyu', 'zihao', 'ming', 'jing', 'yuxuan', 'junwei',

  // Middle Eastern & Slavic
  'omar', 'tariq', 'zayn', 'hamza', 'kareem', 'yusuf', 'bilal', 'samir',
  'fatima', 'layla', 'noor', 'mariam', 'yasmin', 'zara', 'amina', 'reem',
  'dmitri', 'nikolai', 'alexei', 'mikhail', 'sergei', 'ivan', 'boris', 'maksim',
  'natasha', 'anastasia', 'daria', 'polina', 'ksenia', 'olga', 'tatiana'
];

/**
 * Generates a realistic temporary email inbox with user names and numbers only
 * Strictly NO underscores (_), NO dots (.), alphanumeric only.
 * @param {string} _prefix - Ignored to enforce realistic user emails
 * @param {string} domain - Target domain (default: 'mailu.site')
 * @returns {object} { inbox, username, domain, createdAt }
 */
export function generateTempEmail(_prefix = '', domain = DEFAULT_MAILU_DOMAIN) {
  const baseName = REAL_USERNAMES[Math.floor(Math.random() * REAL_USERNAMES.length)];
  const randomNum = Math.floor(100 + Math.random() * 98900); // 3 to 5 digit numbers
  const username = `${baseName}${randomNum}`.toLowerCase().replace(/[^a-z0-9]/g, '');
  const inbox = `${username}@${domain}`;
  return {
    inbox,
    username,
    domain,
    createdAt: new Date().toISOString()
  };
}

/**
 * Fetches the raw OTP directly from Mailu.site
 * Automatically waits up to `timeout` seconds
 * @param {string} inbox - Target email address (e.g. target_user@mailu.site)
 * @param {number} timeout - Wait duration in seconds (default: 30)
 * @param {string} apiKey - Optional Mailu API key override
 * @returns {Promise<{ success: boolean, otp?: string, inbox: string, error?: string, status?: number }>}
 */
export async function fetchRawOtp(inbox, timeout = 30, apiKey = null) {
  if (!inbox) {
    throw new Error('Inbox parameter is required to fetch OTP');
  }

  const cleanInbox = inbox.trim().toLowerCase();
  const username = cleanInbox.split('@')[0];

  // 1. Ensure/revive mailbox on v1 API
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
  } catch (e) {}

  // 2. Poll v1 instant OTP endpoint with token if available
  if (token) {
    try {
      const otpRes = await fetch(`https://mailu.site/api/v1/inbox/otp?timeout=${Math.min(timeout, 25)}`, {
        headers: { 'Authorization': `Bearer ${token}` }
      });
      if (otpRes.ok) {
        const otpData = await otpRes.json();
        if (otpData.success && otpData.otp) {
          return {
            success: true,
            inbox: cleanInbox,
            otp: String(otpData.otp).trim(),
            receivedAt: new Date().toISOString()
          };
        }
      }
    } catch (e) {}
  }

  // 3. Fallback to API key / raw endpoint if configured
  const key = apiKey || process.env.MAILU_API_KEY || DEFAULT_MAILU_API_KEY;
  const encodedInbox = encodeURIComponent(cleanInbox);
  const url = `${MAILU_BASE_URL}/inboxes/${encodedInbox}/otp/raw?api_key=${encodeURIComponent(key)}&timeout=${timeout}`;

  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), (timeout + 5) * 1000);

    const res = await fetch(url, {
      method: 'GET',
      headers: {
        'Accept': 'text/plain, application/json, */*'
      },
      signal: controller.signal
    });

    clearTimeout(timeoutId);

    if (res.ok) {
      const rawText = await res.text();
      const otp = rawText.trim();
      return {
        success: true,
        inbox: cleanInbox,
        otp,
        receivedAt: new Date().toISOString()
      };
    } else {
      const errText = await res.text().catch(() => '');
      return {
        success: false,
        inbox: cleanInbox,
        status: res.status,
        error: `Mailu API error (${res.status}): ${errText || 'OTP not received within timeout'}`
      };
    }
  } catch (err) {
    return {
      success: false,
      inbox: cleanInbox,
      error: err.name === 'AbortError' ? `Request aborted after ${timeout}s timeout` : err.message
    };
  }
}
