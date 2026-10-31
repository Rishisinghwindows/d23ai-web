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
const DIWALI = require("./diwali");

const sa = JSON.parse(process.env.FIREBASE_SA || "{}");
if (!sa.project_id) {
  console.error("Missing/invalid FIREBASE_SA service-account JSON.");
  process.exit(1);
}
admin.initializeApp({ credential: admin.credential.cert(sa) });

const db = admin.firestore();
const LANGS = Object.keys(MESSAGES);

// Best-effort once-per-(day,slot) guard in Firestore so a re-run or a duplicate
// schedule firing can't send the same push twice. A transaction means two runs
// racing can't both win. Returns:
//   "claim"  — we reserved this slot (first time today) → SEND
//   "dup"    — already sent today for this slot → SKIP
//   "proceed"— couldn't check (Firestore disabled/unreachable) → SEND anyway
// We proceed-on-error rather than block: the PUSH_SLOT fix is the primary dup
// guard, so never let a Firestore hiccup silence all notifications.
async function claimSend(dateKey, slot) {
  const ref = db.collection("push_log").doc(`${dateKey}-slot${slot}`);
  try {
    const claimed = await db.runTransaction(async (tx) => {
      const snap = await tx.get(ref);
      if (snap.exists) return false; // already sent today for this slot
      tx.set(ref, { sentAt: admin.firestore.FieldValue.serverTimestamp(), slot });
      return true;
    });
    return claimed ? "claim" : "dup";
  } catch (e) {
    console.warn("Dedup guard unavailable (sending anyway):", String(e));
    return "proceed";
  }
}

// Deterministic "of the day" index (rotates, same for everyone that day).
function dayIndex(d) {
  return Math.floor((d.getTime() - Date.UTC(2024, 0, 1)) / 86400000);
}

// Halloween window (UTC, inclusive). October is month 9 (0-based).
function isHalloween(d) {
  return d.getUTCMonth() === 9 && d.getUTCDate() >= 24 && d.getUTCDate() <= 31;
}

// Diwali window (UTC, inclusive) — matches the in-app seasonal window (Nov 1-14).
// November is month 10 (0-based). The 03:30 UTC early run lands at 9:00 IST,
// prime time for the audience that celebrates.
function isDiwali(d) {
  return d.getUTCMonth() === 10 && d.getUTCDate() >= 1 && d.getUTCDate() <= 14;
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
  // Slot comes from which cron fired (passed by the workflow as PUSH_SLOT), NOT
  // the wall-clock hour — GitHub's scheduler can run crons very late, which would
  // otherwise make both daily runs pick the same slot. 0 = early, 1 = main.
  const slot = process.env.PUSH_SLOT === "0" ? 0 : 1;
  // At most one festival window is active at a time; its pool replaces the
  // daily one and unlocks the second (early) slot for 2 messages/day.
  const festival = isHalloween(now) ? { pool: HALLOWEEN, tag: "HALLOWEEN" }
                 : isDiwali(now)    ? { pool: DIWALI,    tag: "DIWALI" }
                 : null;

  // Off-season: the early slot stays silent so users still get exactly one a day.
  if (!festival && slot === 0) {
    console.log("Off-season early slot — skipping to keep 1 message/day.");
    return;
  }

  // Once-per-(day,slot) guard: if this slot already went out today, stop here so
  // a GitHub re-run or a duplicate schedule firing can't buzz everyone twice.
  const dateKey = now.toISOString().slice(0, 10); // YYYY-MM-DD (UTC)
  const claim = await claimSend(dateKey, slot);
  if (claim === "dup") {
    console.log(`Slot ${slot} for ${dateKey} already sent — skipping to avoid a duplicate.`);
    return;
  }

  const pool = festival ? festival.pool : MESSAGES;
  const di = dayIndex(now);
  // During a festival the two daily runs pick two different messages.
  const pick = festival ? di * 2 + slot : di;

  const results = [];
  for (const lang of LANGS) {
    const arr = pool[lang] || pool.en;
    results.push(await sendTo(lang, arr[pick % arr.length]));
  }
  const tag = festival ? `${festival.tag} slot ${slot}` : "daily";
  console.log(`[${tag}] push results:`, JSON.stringify(results, null, 2));
  if (results.every((r) => r.error)) process.exit(1); // fail the job if all failed
}

main();
