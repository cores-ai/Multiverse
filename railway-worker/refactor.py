import os
import re

file_path = "telegram_bot.js"
with open(file_path, "r", encoding="utf-8") as f:
    content = f.read()

# Replace globals and cleanup
old_globals = """let currentBrowserContext = null;
let currentPage = null;
let waitingForEmailInChat = null;
let waitingForOTPInChat = null;
let currentEmail = null;

let sessionTimeoutTimer = null;

async function closeAndCleanSession(chatId, silent = false) {
    if (sessionTimeoutTimer) {
        clearTimeout(sessionTimeoutTimer);
        sessionTimeoutTimer = null;
    }
    waitingForEmailInChat = null;
    waitingForOTPInChat = null;
    currentEmail = null;
    
    if (currentBrowserContext) {
        await currentBrowserContext.close().catch(() => {});
        currentBrowserContext = null;
        currentPage = null;
    }
    try {
        const sessionDir = path.resolve(__dirname, 'sessions', 'firefox_profile');
        clearDirectorySafe(sessionDir);
    } catch (e) {}

    if (!silent && chatId) {
        await bot.sendMessage(chatId, '⚠️ Session closed due to 5 minutes of inactivity.');
    }
}

function startInactivityTimer(chatId) {
    if (sessionTimeoutTimer) clearTimeout(sessionTimeoutTimer);
    sessionTimeoutTimer = setTimeout(() => {
        closeAndCleanSession(chatId, false);
    }, 5 * 60 * 1000); // 5 minutes
}"""

new_globals = """const userSessions = new Map();

function getSession(chatId) {
    if (!userSessions.has(chatId)) {
        userSessions.set(chatId, {
            browserContext: null,
            page: null,
            state: 'IDLE', // IDLE, WAITING_EMAIL, WAITING_OTP
            email: null,
            timeoutTimer: null
        });
    }
    return userSessions.get(chatId);
}

async function closeAndCleanSession(chatId, silent = false) {
    const session = userSessions.get(chatId);
    if (!session) return;
    
    if (session.timeoutTimer) {
        clearTimeout(session.timeoutTimer);
    }
    
    if (session.browserContext) {
        await session.browserContext.close().catch(() => {});
    }
    
    try {
        const sessionDir = path.resolve(__dirname, 'sessions', `firefox_profile_${chatId}`);
        clearDirectorySafe(sessionDir);
    } catch (e) {}
    
    userSessions.delete(chatId);

    if (!silent && chatId) {
        await bot.sendMessage(chatId, '⚠️ Session closed due to 2 minutes of inactivity.').catch(()=>{});
    }
}

function startInactivityTimer(chatId) {
    const session = getSession(chatId);
    if (session.timeoutTimer) clearTimeout(session.timeoutTimer);
    session.timeoutTimer = setTimeout(() => {
        closeAndCleanSession(chatId, false);
    }, 2 * 60 * 1000); // 2 minutes
}"""

content = content.replace(old_globals, new_globals)

# Replace in startCustomSession
old_start = """async function startCustomSession(chat, msgId) {
    await bot.editMessageText('⚡ Server Creating...', { chat_id: chat, message_id: msgId }).catch(()=>{});

    if (currentBrowserContext) {
        await bot.editMessageText('⚠️ A session is already active! Closing the old one...', { chat_id: chat, message_id: msgId }).catch(()=>{});
        await currentBrowserContext.close().catch(() => {});
    }

    const sessionDir = path.resolve(__dirname, 'sessions', 'firefox_profile');"""

new_start = """async function startCustomSession(chat, msgId) {
    const session = getSession(chat);
    await bot.editMessageText('⚡ Server Creating...', { chat_id: chat, message_id: msgId }).catch(()=>{});

    if (session.browserContext) {
        await bot.editMessageText('⚠️ A session is already active! Closing the old one...', { chat_id: chat, message_id: msgId }).catch(()=>{});
        await session.browserContext.close().catch(() => {});
    }

    const sessionDir = path.resolve(__dirname, 'sessions', `firefox_profile_${chat}`);"""

content = content.replace(old_start, new_start)

# Replace waitingForEmailInChat = chat with session.state = 'WAITING_EMAIL' in startCustomSession
content = content.replace("waitingForEmailInChat = chat;", "session.state = 'WAITING_EMAIL';")

# In bot.on('message', ...) we need to get the session and replace global checks
old_msg_start = """bot.on('message', async (msg) => {
    const chat = msg.chat.id;
    const text = msg.text;

    // Ignore commands
    if (text && text.startsWith('/')) return;

    if (text && text.includes('@') && waitingForEmailInChat === chat) {
        waitingForEmailInChat = null;
        startInactivityTimer(chat);"""

new_msg_start = """bot.on('message', async (msg) => {
    const chat = msg.chat.id;
    const text = msg.text;
    const session = getSession(chat);

    // Ignore commands
    if (text && text.startsWith('/')) return;

    if (text && text.includes('@') && session.state === 'WAITING_EMAIL') {
        session.state = 'IDLE';
        startInactivityTimer(chat);"""

content = content.replace(old_msg_start, new_msg_start)

old_email_check = """if (currentPage && !currentPage.isClosed()) {
            try {
                const email = text.trim();
                currentEmail = email;"""
new_email_check = """if (session.page && !session.page.isClosed()) {
            try {
                const email = text.trim();
                session.email = email;"""
content = content.replace(old_email_check, new_email_check)

old_otp_prompt = """await updateProg(chat, statusMsg.message_id, 100, 'OTP sent! ✅');
                    await new Promise(r => setTimeout(r, 1000));
                    
                    waitingForOTPInChat = chat;
                    await bot.sendMessage(chat, '🔑 Send your 6-digit OTP code.');
                }
            } catch(e) {"""

new_otp_prompt = """await updateProg(chat, statusMsg.message_id, 100, 'OTP sent! ✅');
                    await new Promise(r => setTimeout(r, 1000));
                    
                    session.state = 'WAITING_OTP';
                    await bot.sendMessage(chat, '🔑 Send your 6-digit OTP code.');
                }
            } catch(e) {"""
content = content.replace(old_otp_prompt, new_otp_prompt)

old_otp_flow = """} else if (text && /^\d{6}$/.test(text.trim()) && waitingForOTPInChat === chat) {
        waitingForOTPInChat = null;
        startInactivityTimer(chat);
        const otpStatusMsg = await bot.sendMessage(chat, '🚀 Processing...\n[⬜⬜⬜⬜⬜⬜⬜⬜⬜⬜] 0%\n👉 Initializing...');

        if (currentPage && !currentPage.isClosed()) {"""

new_otp_flow = """} else if (text && /^\d{6}$/.test(text.trim()) && session.state === 'WAITING_OTP') {
        session.state = 'IDLE';
        startInactivityTimer(chat);
        const otpStatusMsg = await bot.sendMessage(chat, '🚀 Processing...\n[⬜⬜⬜⬜⬜⬜⬜⬜⬜⬜] 0%\n👉 Initializing...');

        if (session.page && !session.page.isClosed()) {"""
content = content.replace(old_otp_flow, new_otp_flow)

# Fix currentEmail variable inside OTP block
content = content.replace("📧 Email: ${currentEmail || 'Unknown'}", "📧 Email: ${session.email || 'Unknown'}")

# Now regex replace currentBrowserContext with session.browserContext, and currentPage with session.page
# BUT ONLY inside startCustomSession and bot.on('message') !
# Actually we can just do a global replace because these globals don't exist anymore!
content = content.replace('currentBrowserContext', 'session.browserContext')
content = content.replace('currentPage', 'session.page')

with open(file_path, "w", encoding="utf-8") as f:
    f.write(content)
print("Done refactoring.")
