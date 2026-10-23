/**
 * Monoline daily funny push — FREE, no Cloud Functions / no Blaze.
 *
 * Runs from GitHub Actions on a schedule. Sends one rotating, localized funny
 * message to each per-language FCM topic (lang_en, lang_es, …). Sending FCM
 * messages via the Admin SDK is free on the Spark plan.
 *
 * Auth: a Firebase service-account JSON provided via the FIREBASE_SA env var
 * (stored as the GitHub secret FIREBASE_SERVICE_ACCOUNT).
 */
const admin = require("firebase-admin");
const MESSAGES = require("./messages");

const sa = JSON.parse(process.env.FIREBASE_SA || "{}");
if (!sa.project_id) {
  console.error("Missing/invalid FIREBASE_SA service-account JSON.");
  process.exit(1);
}
admin.initializeApp({ credential: admin.credential.cert(sa) });

const LANGS = Object.keys(MESSAGES);

// Deterministic "message of the day" index (rotates, same for everyone today).
function dayIndex() {
  const start = Date.UTC(2024, 0, 1);
  return Math.floor((Date.now() - start) / 86400000);
}

async function main() {
  const idx = dayIndex();
  const results = [];
  for (const lang of LANGS) {
    const pool = MESSAGES[lang] || MESSAGES.en;
    const m = pool[idx % pool.length];
    try {
      const id = await admin.messaging().send({
        topic: `lang_${lang}`,
        notification: { title: m.title, body: m.body },
        apns: { payload: { aps: { sound: "default" } } },
      });
      results.push({ lang, ok: id });
    } catch (e) {
      results.push({ lang, error: String(e) });
    }
  }
  console.log("Daily push results:", JSON.stringify(results, null, 2));
  if (results.every((r) => r.error)) process.exit(1); // fail the job if all failed
}

main();
