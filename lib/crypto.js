import crypto from 'crypto';

const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 12; // Standard 96-bit IV for GCM
const AUTH_TAG_LENGTH = 16;

/**
 * Derives a 32-byte master encryption key from the environment secret.
 * Falls back to a deterministic SHA-256 hash if custom string is provided.
 */
function getMasterKey() {
    const rawKey = process.env.ENCRYPTION_MASTER_KEY || 'default-fallback-master-secret-key-32b-change-me!';
    return crypto.createHash('sha256').update(rawKey).digest();
}

/**
 * Encrypts an object or string using AES-256-GCM.
 * Output format: "aes-gcm:ivHex:authTagHex:encryptedHex"
 */
export function encryptData(data) {
    if (data === undefined || data === null) return null;
    
    const key = getMasterKey();
    const iv = crypto.randomBytes(IV_LENGTH);
    const cipher = crypto.createCipheriv(ALGORITHM, key, iv, { authTagLength: AUTH_TAG_LENGTH });
    
    const textToEncrypt = typeof data === 'object' ? JSON.stringify(data) : String(data);
    let encrypted = cipher.update(textToEncrypt, 'utf8', 'hex');
    encrypted += cipher.final('hex');
    
    const authTag = cipher.getAuthTag().toString('hex');
    
    return `aes-gcm:${iv.toString('hex')}:${authTag}:${encrypted}`;
}

/**
 * Decrypts an AES-256-GCM encrypted payload back to its original object/string.
 */
export function decryptData(cipherPayload) {
    if (!cipherPayload || typeof cipherPayload !== 'string') return null;
    
    const parts = cipherPayload.split(':');
    if (parts.length !== 4 || parts[0] !== 'aes-gcm') {
        // Plaintext fallback for legacy/unencrypted entries
        try {
            return JSON.parse(cipherPayload);
        } catch {
            return cipherPayload;
        }
    }
    
    const [, ivHex, authTagHex, encryptedHex] = parts;
    const key = getMasterKey();
    const iv = Buffer.from(ivHex, 'hex');
    const authTag = Buffer.from(authTagHex, 'hex');
    
    const decipher = crypto.createDecipheriv(ALGORITHM, key, iv, { authTagLength: AUTH_TAG_LENGTH });
    decipher.setAuthTag(authTag);
    
    let decrypted = decipher.update(encryptedHex, 'hex', 'utf8');
    decrypted += decipher.final('utf8');
    
    try {
        return JSON.parse(decrypted);
    } catch {
        return decrypted;
    }
}
