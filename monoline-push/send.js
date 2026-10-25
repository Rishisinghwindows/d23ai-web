/**
 * Monoline daily funny push — FREE, no Cloud Functions / no Blaze.
 *
 * Runs from GitHub Actions on a schedule. Sends a rotating, localized message to
 * each per-language FCM topic (lang_en, lang_es, …). Sending FCM messages via the
 * Admin SDK is free on the Spark plan.
 *
 * Cadence:
 *   • Off-season  → ONE message per day (the main 11:30 UTC run).
 *   • Halloween window (Oct 24–31 UTC) → TWO messages per day, from the spooky
 *     pool (the early 03:30 UTC run + the main 11:30 UTC run), each distinct.
 *
 * Auth: a Firebase service-account JSON via FIREBASE_SA (GitHub secret
 * FIREBASE_SERVICE_ACCOUNT).
 */
const admin = require("firebase-admin");
const MESSAGES = require("./messages");
const HALLOWEEN = require("./halloween");

const sa = JSON.parse(process.env.FIREBASE_SA || "{}");
if (!sa.project_id) {
  console.error("Missing/invalid FIREBASE_SA service-account JSON.");
  process.exit(1);
}
admin.initializeApp({ credential: admin.credential.cert(sa) });

const LANGS = Object.keys(MESSAGES);

// Deterministic "of the day" index (rotates, same for everyone that day).
function dayIndex(d) {
  return Math.floor((d.getTime() - Date.UTC(2024, 0, 1)) / 86400000);
}

// Halloween window (UTC, inclusive). October is month 9 (0-based).
function isHalloween(d) {
  return d.getUTCMonth() === 9 && d.getUTCDate() >= 24 && d.getUTCDate() <= 31;
}

async function sendTo(lang, m) {
  try {
    const id = await admin.messaging().send({
      topic: `lang_${lang}`,
      notification: { title: m.title, body: m.body },
      apns: { payload: { aps: { sound: "default" } } },
    });
    return { lang, ok: id };
  } catch (e) {
    return { lang, error: String(e) };
  }
}

async function main() {
  const now = new Date();
  const slot = now.getUTCHours() < 8 ? 0 : 1; // 0 = early (03:30), 1 = main (11:30)
  const halloween = isHalloween(now);

  // Off-season: the early slot stays silent so users still get exactly one a day.
  if (!halloween && slot === 0) {
    console.log("Off-season early slot — skipping to keep 1 message/day.");
    return;
  }

  const pool = halloween ? HALLOWEEN : MESSAGES;
  const di = dayIndex(now);
  // During Halloween the two daily runs pick two different messages.
  const pick = halloween ? di * 2 + slot : di;

  const results = [];
  for (const lang of LANGS) {
    const arr = pool[lang] || pool.en;
    results.push(await sendTo(lang, arr[pick % arr.length]));
  }
  const tag = halloween ? `HALLOWEEN slot ${slot}` : "daily";
  console.log(`[${tag}] push results:`, JSON.stringify(results, null, 2));
  if (results.every((r) => r.error)) process.exit(1); // fail the job if all failed
}

main();
