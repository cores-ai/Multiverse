# ⚡ Middleman — Autonomous Multi-Account Cloud Controller (Vercel Ready)

Middleman ek enterprise-grade autonomous cloud orchestration platform aur futuristic admin command center hai. Yeh multiple Railway accounts ka pool manage karta hai, GitHub repos ko direct push karta hai, MongoDB me military-grade AES-256 encrypted environment variables bind karta hai, aur low-credit (< $2) ya slot exhaustion par **Just-In-Time (JIT)** accounts harvest karke zero-downtime Blue-Green deployments karta hai.

---

## 🌟 Key Capabilities

* **2-Slot Fleet Balancer:** Har Railway account me maximum 2 repos/services allow karta hai taaki resource overload na ho.
* **Just-In-Time (JIT) Provisioning:** Accounts pehle se bekar me banakar unke 30 din trial expire nahi hone deta. Account tabhi generate hota hai jab slots full hon ya credit <= $2.00 bache.
* **Zero Paid Proxy Dependency:** Native fingerprint camouflage (Google DNS DoH, WebRTC blocker, RTX 3060 spoofing) ke sath chalta hai—kisi mehenge residential proxy ki zaroorat nahi.
* **AES-256-GCM Cryptographic Vault:** Saare bot tokens, Railway keys aur repo-specific envs database me military-grade encryption ke sath secure rehte hain.
* **Live Ingestion Pipeline:** User frontend me repo files aur envs enter karta hai -> Middleman auto GitHub push karta hai -> MongoDB me envs link karta hai -> Railway par deploy karta hai.
* **Zero-Downtime Blue-Green Cutover:** $2.00 credit aane par naye account me parallel deploy karke health status verify hone ke baad purani service ko safely retire karta hai.

---

## 📁 Project Structure

```
middleman/
├── app/
│   ├── api/
│   │   ├── accounts/route.js          # Railway account fleet & credits
│   │   ├── repos/route.js             # Ingest repo, GitHub push, Railway deploy
│   │   ├── envs/route.js              # Read/write/version strictly linked envs
│   │   ├── watchdog/route.js          # Health pings & auto-migration engine
│   │   ├── logs/route.js              # Real-time event stream
│   │   └── webhooks/
│   │       └── account-ready/route.js # Async callback from Playwright worker
│   ├── globals.css                    # Cyberpunk glassmorphic Vanilla CSS
│   ├── layout.js                      # Root layout with fonts & SEO tags
│   └── page.js                        # Master Cyber Admin Dashboard
├── lib/
│   ├── crypto.js                      # AES-256-GCM encryption & decryption
│   ├── mongodb.js                     # Cached connection pool for Vercel
│   ├── models.js                      # MongoDB collections & queries
│   ├── railway.js                     # Railway GraphQL API engine
│   ├── github.js                      # GitHub Octokit API engine
│   ├── balancer.js                    # 2-Slot capacity allocator
│   └── migration.js                   # Blue-Green zero-downtime orchestrator
├── .env.example
├── package.json
└── README.md
```

---

## 🚀 Quick Start (Local Run)

### 1. Dependencies Install Karein:
```bash
cd middleman
npm install
```

### 2. Environment Variables Configure Karein:
`.env.example` ko copy karke `.env.local` banayein:
```bash
cp .env.example .env.local
```
Apni credentials enter karein:
* `MONGODB_URI`: MongoDB Atlas connection string (`mongodb+srv://...`)
* `GITHUB_TOKEN`: GitHub Personal Access Token (with `repo` & `workflow` scopes)
* `ENCRYPTION_MASTER_KEY`: 32-character random string (e.g. `my-vault-encryption-secret-key-32b!`)
* `WEBHOOK_SECRET`: `mega-server-jit-worker-secret-2026`

### 3. Run Dev Server:
```bash
npm run dev
```
Open [http://localhost:3000](http://localhost:3000) browser me.

---

## 🌐 Deploy to Vercel (1-Click Production)

1. **GitHub Par Push Karein:**
   ```bash
   cd middleman
   git init
   git add .
   git commit -m "Initial commit of Middleman Controller"
   git branch -M main
   git remote add origin https://github.com/your-username/middleman.git
   git push -u origin main
   ```

2. **Vercel me Import Karein:**
   * [vercel.com](https://vercel.com) par jayein aur **Add New Project** click karein.
   * Apni `middleman` repository select karein.
   * **Environment Variables** me `.env.example` wali saari keys add karein (`MONGODB_URI`, `GITHUB_TOKEN`, `ENCRYPTION_MASTER_KEY`, etc.).
   * **Deploy** click karein! Zero-config deployment complete ho jayega.

---

## 🤖 Playwright Token Harvesting Worker Setup

Aapke `Rilway Server` folder me [`account_worker.js`](../Rilway%20Server/account_worker.js) provide kiya gaya hai.
Jab bhi JIT trigger execute hoga ya manual command deni ho:
```bash
cd "Rilway Server"
node account_worker.js
```
Yeh worker headless Firefox stealth mode me Railway API token harvest karega aur Middleman ke `/api/webhooks/account-ready` par secure callback bhejkar naya account pool me register kar dega!
