// One-time Word Worlds launch announcement, localized into the app's 8 languages.
// Sent by send.js on WW_LAUNCH_DATE (main slot only), WITH a deep-link data payload
// {route:"word", level:"1"} so tapping opens the first word board directly in-app.
// (The app's AppRouter.handle reads route/level from the notification userInfo.)

module.exports = {
  en: { title: "🔤 New: Word Worlds!", body: "Learn a real word in one unbroken line. Tap to trace your first word →" },
  hi: { title: "🔤 नया: Word Worlds!", body: "एक अटूट रेखा में असली शब्द सीखें। अपना पहला शब्द बनाने के लिए टैप करें →" },
  es: { title: "🔤 ¡Nuevo: Word Worlds!", body: "Aprende una palabra real con una sola línea. Toca para trazar tu primera palabra →" },
  fr: { title: "🔤 Nouveau : Word Worlds !", body: "Apprends un vrai mot d'un seul trait. Touche pour tracer ton premier mot →" },
  de: { title: "🔤 Neu: Word Worlds!", body: "Lerne ein echtes Wort mit einer Linie. Tippe und zeichne dein erstes Wort →" },
  it: { title: "🔤 Novità: Word Worlds!", body: "Impara una parola vera con una sola linea. Tocca per tracciare la tua prima parola →" },
  pt: { title: "🔤 Novo: Word Worlds!", body: "Aprende uma palavra verdadeira com uma só linha. Toca para traçar a tua primeira palavra →" },
  nl: { title: "🔤 Nieuw: Word Worlds!", body: "Leer een echt woord met één lijn. Tik om je eerste woord te tekenen →" },
};
