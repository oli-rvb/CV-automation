/* Chef d'orchestre de la collecte. Tourne en arrière-plan : on peut fermer
   la popup, la collecte continue. Rythme volontairement humain (pauses
   aléatoires, jamais moins de 500 ms) pour ne pas surcharger le site. */

const APP_URL = 'http://localhost:3333';
const MAX_PAGES = 30;

let status = { running: false, phase: 'idle', message: 'Prêt.' };
let stopRequested = false;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const humanPause = (min, max) => sleep(min + Math.random() * (max - min));

function setStatus(patch) {
  status = { ...status, ...patch };
  chrome.runtime.sendMessage({ type: 'status', status }).catch(() => {}); // popup fermée : pas grave
}

// Envoie un ordre au script de la page. Réessaie quelques secondes : si la
// pagination recharge la page, le script met un instant à revenir.
async function ask(tabId, msg) {
  let lastErr;
  for (let i = 0; i < 20; i++) {
    try {
      const res = await chrome.tabs.sendMessage(tabId, msg);
      if (res && res.error) throw new Error(res.error);
      if (res) return res;
    } catch (err) {
      lastErr = err;
    }
    await sleep(500);
  }
  throw lastErr || new Error('La page ne répond pas.');
}

async function run(tabId) {
  stopRequested = false;
  const found = new Map();
  setStatus({ running: true, phase: 'pages', message: 'Lecture de la page 1…', sent: 0, error: '' });

  try {
    // Extension installée après l'ouverture de l'onglet : on injecte le script.
    try { await chrome.tabs.sendMessage(tabId, { type: 'ping' }); } catch {
      await chrome.scripting.executeScript({ target: { tabId }, files: ['content.js'] });
    }

    // 1. Parcourt toutes les pages de résultats
    let prevFirst = null;
    for (let page = 1; page <= MAX_PAGES && !stopRequested; page++) {
      const { cards, changed } = await ask(tabId, { type: 'collect', prevFirst });
      if (page > 1 && !changed) break; // le clic n'a rien changé : dernière page
      cards.forEach((c) => found.has(c.url) || found.set(c.url, c));
      prevFirst = cards[0] && cards[0].url;
      setStatus({ message: `Page ${page} lue — ${found.size} offres trouvées.` });

      await humanPause(1500, 3000);
      if (stopRequested) break;
      const { clicked } = await ask(tabId, { type: 'next' });
      if (!clicked) break;
    }

    // 2. Ouvre chaque offre (en arrière-plan) pour lire l'annonce complète
    const jobs = [];
    const list = [...found.values()];
    setStatus({ phase: 'details' });
    for (let i = 0; i < list.length && !stopRequested; i++) {
      setStatus({ message: `Lecture des annonces : ${i + 1} / ${list.length}` });
      try {
        const detail = await ask(tabId, { type: 'fetchJob', url: list[i].url });
        jobs.push({ ...list[i], ...Object.fromEntries(Object.entries(detail).filter(([, v]) => v)) });
      } catch (err) {
        jobs.push({ ...list[i], description: '', error: err.message });
      }
      await humanPause(800, 2000);
    }

    // 3. Envoie le tout à l'Éditeur de CV (même partiel si on a arrêté)
    setStatus({ phase: 'sending', message: `Envoi de ${jobs.length} offres à l'Éditeur de CV…` });
    const res = await fetch(`${APP_URL}/jobs`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ jobs }),
    });
    if (!res.ok) throw new Error(`L'app a répondu ${res.status}`);
    setStatus({ running: false, phase: 'done', sent: jobs.length, message: `${jobs.length} offres envoyées. Ouvrez l'Éditeur de CV → « Offres collectées ».` });
  } catch (err) {
    const hint = /fetch/i.test(err.message) ? ' Le serveur tourne-t-il (node server.js) ?' : '';
    setStatus({ running: false, phase: 'error', message: `Erreur : ${err.message}.${hint}` });
  }
}

chrome.runtime.onMessage.addListener((msg, _sender, reply) => {
  if (msg.type === 'start' && !status.running) run(msg.tabId);
  if (msg.type === 'stop') stopRequested = true;
  reply({ status });
});
