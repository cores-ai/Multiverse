# Playwright Firefox Persistent Sessions (With Full Hardware Spoofing)

Playwright ke zariye Firefox ka persistent browser session aapke folder (`./sessions/firefox_profile`) me store hota hai aur aapka **real hardware data, IP leak, aur fingerprints** fully spoof / mask rahenge.

---

## 🛡️ Anti-Fingerprint & Hardware Spoofing Features

| Feature | Protection / Spoofing Applied |
|---|---|
| **Inbuilt Google DNS** | Official Google DNS over HTTPS (`https://dns.google/dns-query` / `8.8.8.8`) securely enabled to prevent ISP DNS leaks. |
| **GPU / Graphics Card** | Real GPU hide karke fake GPU (`NVIDIA GeForce RTX 3060`) inject hota hai. |
| **CPU Cores & RAM** | Real hardware ki jagah `8 Cores` aur `8 GB RAM` show hota hai. |
| **WebRTC IP Leak** | Direct local IP candidate gathering block rehti hai taaki real IP leak na ho. |
| **Canvas & Audio** | Unique noise inject hota hai jisse unique canvas/audio fingerprint track na ho sake. |
| **Screen Resolution** | 1920x1080 standard desktop display spoofed. |
| **Timezone & Location** | Custom Timezone (`America/New_York`) aur Geolocation inject hoti hai. |
| **Automation Detection** | `navigator.webdriver = false`, automation flags removed. |

---

## ⚙️ Spoofing Settings Customize Kaise Karein

Aap [`spoof_config.js`](file:///c:/Users/iq4u8/Desktop/crome/spoof_config.js) open karke apni pasand ke anusar specs, timezone, ya proxy change kar sakte hain:
- CPU Cores (`hardware.concurrency`)
- RAM (`hardware.deviceMemory`)
- GPU Model (`gpu.renderer`)
- Timezone (`timezoneId`)
- Proxy server (`proxy`)

---

## 📁 Folder Structure

```
crome/
├── sessions/
│   ├── firefox_profile/        # Persistent Firefox cookies, history, logins
│   └── firefox_state.json      # Exported JSON session state
├── spoof_config.js             # Hardware & fingerprint spoofing configuration
├── stealth_injections.js       # In-page stealth & prototype spoofing scripts
├── launch_firefox_session.js   # Main launcher with persistent session & spoofing
├── save_load_storage_state.js  # JSON state export/import script
├── firefox_session.py          # Python session script with spoofing
├── package.json
└── README.md
```

---

## 🚀 Commands (How to Run)

### 1. Persistent Browser Launch (Node.js - Recommended):
```powershell
npm start
```
ya custom URL ke sath:
```powershell
node launch_firefox_session.js https://bot.sannysoft.com
```

### 2. Session State JSON Save / Load:
- **Save State:** `npm run save-state`
- **Load State:** `npm run load-state`

### 3. Python se Chalana:
```powershell
python firefox_session.py
```
