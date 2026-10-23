# Monoline daily push — FREE setup (no Blaze)

Automated daily funny message to all users, via GitHub Actions + FCM. Sending FCM
messages is **free on the Spark plan** — only Cloud Functions need Blaze, and we
don't use them here.

## How it works
```
GitHub Actions (daily cron)  →  send.js  →  firebase-admin  →  FCM topics (lang_en…)  →  all devices
```
The app already subscribes each install to `all` + `lang_<code>`. The script picks a
rotating, localized message from `messages.js` and sends it to each language topic.

## One-time setup (≈3 min)

### 1. Create a Firebase service account key
1. Firebase console → **⚙️ Project settings → Service accounts**.
2. **Generate new private key** → downloads a JSON file. (Keep it secret.)

### 2. Add it as a GitHub secret
1. GitHub → the **d23ai-web** repo → **Settings → Secrets and variables → Actions**.
2. **New repository secret**:
   - **Name:** `FIREBASE_SERVICE_ACCOUNT`
   - **Value:** paste the **entire contents** of the JSON file.
3. Save.

### 3. Done
- The workflow runs **daily at 17:00 IST** (`30 11 * * *` UTC). Change the cron in
  `.github/workflows/monoline-daily-push.yml` if you want a different time.
- **Test it now:** GitHub → **Actions → Monoline daily push → Run workflow**. Every
  subscribed device gets today's funny line in its language.

## Editing the messages
`monoline-push/messages.js` holds 6 lines per language. Edit freely and commit —
one is chosen per day (rotating), so players never see the same one two days running.

## Also works: fully manual (no GitHub needed)
You can always send by hand from **Firebase console → Messaging → New campaign →
Notifications**, targeting the **topic** `all` (one message to everyone) or a
specific `lang_en` etc. Free, instant, zero setup.

## Cost
$0. FCM sending is free, GitHub Actions is free for this repo, and a ~1-min daily
job is far inside the free minutes.
