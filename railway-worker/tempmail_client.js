/**
 * Mailu.site Temp Mail & OTP Client for Railway Worker Engine
 */

require('dotenv').config();

const API_KEY = process.env.MAILU_API_KEY || 'ml_live_YOUR_KEY_HERE';
const DOMAIN = process.env.MAILU_DOMAIN || 'mailu.site';
const BASE_URL = 'https://mailu.site/api/v1';

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
  
  // European
  'marcus', 'leon', 'felix', 'moritz', 'jonas', 'lukas', 'elias', 'finn',
  'antoine', 'julien', 'maxime', 'arthur', 'clara', 'chloe', 'camille', 'manon',
  
  // Asian
  'yuki', 'haruto', 'yuto', 'kaito', 'riku', 'kenji', 'daiki', 'kazuki',
  'yui', 'hina', 'sakura', 'aoi', 'rin', 'mei', 'nanami', 'ayaka',
  
  // Middle Eastern & Slavic
  'omar', 'tariq', 'zayn', 'hamza', 'kareem', 'yusuf', 'bilal', 'samir',
  'dmitri', 'nikolai', 'alexei', 'mikhail', 'sergei', 'ivan', 'boris', 'maksim'
];

/**
 * Generates a realistic temporary email without any underscores or dots
 * Strictly alphanumeric only (real user name + random numbers)
 * @param {string} _prefix - Ignored to prevent unwanted symbols
 * @returns {string} email address e.g. alexander4829@mailu.site
 */
function generateTempEmail(_prefix = '') {
    const baseName = REAL_USERNAMES[Math.floor(Math.random() * REAL_USERNAMES.length)];
    const randomNum = Math.floor(100 + Math.random() * 98900);
    const username = `${baseName}${randomNum}`.toLowerCase().replace(/[^a-z0-9]/g, '');
    return `${username}@${DOMAIN}`;
}

/**
 * Fetches raw OTP for given inbox with timeout (in seconds)
 * Directly matches the automation snippet
 * @param {string} inbox 
 * @param {number} timeout 
 * @param {string} customApiKey 
 * @returns {Promise<string>} raw OTP text
 */
async function fetchRawOtp(inbox, timeout = 30, customApiKey = null) {
    const key = customApiKey || API_KEY;
    const url = `${BASE_URL}/inboxes/${encodeURIComponent(inbox)}/otp/raw?api_key=${encodeURIComponent(key)}&timeout=${timeout}`;
    
    console.log(`[TempMail] Polling OTP for inbox: ${inbox} (timeout: ${timeout}s)...`);
    const res = await fetch(url);
    if (res.ok) {
        const otp = (await res.text()).trim();
        console.log(`✅ [TempMail] OTP received: ${otp}`);
        return otp;
    } else {
        const errorText = await res.text().catch(() => '');
        console.error(`❌ [TempMail] Failed to get OTP (status: ${res.status}): ${errorText}`);
        throw new Error(`OTP fetch failed with status ${res.status}: ${errorText}`);
    }
}

module.exports = {
    generateTempEmail,
    fetchRawOtp
};
