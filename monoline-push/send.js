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
const LAUNCH = require("./launch");   // one-time Word Worlds announcement

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

async function sendTo(lang, m, data) {
  try {
    const msg = {
      topic: `lang_${lang}`,
      notification: { title: m.title, body: m.body },
      apns: { payload: { aps: { sound: "default" } } },
    };
    if (data) msg.data = data;   // deep-link keys (route/level) → delivered in userInfo on tap
    const id = await admin.messaging().send(msg);
    return { lang, ok: id };
  } catch (e) {
    return { lang, error: String(e) };
  }
}

async function main() {
  const now = new Date();
  const dateKeyEarly = now.toISOString().slice(0, 10); // YYYY-MM-DD (UTC)

  // ---- Word Worlds EVENING PROMO (timezone-segmented) ----
  // A promo cron sets WW_PROMO_LANGS to the language group whose local evening it is
  // (~8pm, the casual-game session peak). Deep-linked into the word board. Reuses the
  // localized WW announcement copy. Gated by WW_PROMO_ON=1 so it is armed but inert
  // until you run the campaign; dedup is per (day, group).
  const promoLangs = (process.env.WW_PROMO_LANGS || "").split(",").map(x => x.trim()).filter(Boolean);
  if (promoLangs.length) {
    if (process.env.WW_PROMO_ON !== "1") { console.log("Word promo disabled (WW_PROMO_ON != 1)."); return; }
    const grp = promoLangs.join("-");
    const pc = await claimSend(dateKeyEarly, "wwpromo-" + grp);
    if (pc === "dup") { console.log(`Word promo for ${grp} already sent ${dateKeyEarly}.`); return; }
    const pres = [];
    for (const lang of promoLangs) {
      const m = LAUNCH[lang] || LAUNCH.en;
      pres.push(await sendTo(lang, m, { route: "word", level: "1", src: "evening-promo" }));
    }
    console.log(`[WORD WORLDS PROMO ${grp}]`, JSON.stringify(pres, null, 2));
    if (pres.every((r) => r.error)) process.exit(1);
    return; // promo run is dedicated — never also sends the daily
  }

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

  // One-time Word Worlds launch announcement: fires on WW_LAUNCH_DATE's MAIN run,
  // deep-linked (route=word) so a tap opens the first word board. It replaces that
  // day's daily message. Set WW_LAUNCH_DATE="YYYY-MM-DD" (UTC) to arm it.
  const LAUNCH_DATE = (process.env.WW_LAUNCH_DATE || "").trim();
  if (slot === 1 && LAUNCH_DATE && dateKey === LAUNCH_DATE) {
    const lc = await claimSend(dateKey, "launch");
    if (lc === "dup") { console.log("Launch push already sent today — skipping."); return; }
    const lres = [];
    for (const lang of LANGS) {
      const m = LAUNCH[lang] || LAUNCH.en;
      lres.push(await sendTo(lang, m, { route: "word", level: "1", src: "launch" }));
    }
    console.log("[WORD WORLDS LAUNCH] results:", JSON.stringify(lres, null, 2));
    if (lres.every((r) => r.error)) process.exit(1);
    return; // the launch replaces today's daily push
  }

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
