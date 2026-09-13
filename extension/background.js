/* Chef d'orchestre de la collecte. Tourne en arrière-plan : on peut fermer
   la popup, la collecte continue. Rythme volontairement humain (pauses
   aléatoires, jamais moins de 1,5 s entre deux annonces, pause plus longue
   toutes les 5 annonces) pour ne pas surcharger le site. Si WTTJ signale
   un blocage (HTTP 202/403/429), on ralentit encore plus (backoff) plutôt
   que d'essayer de le contourner. */

const APP_URL = 'http://localhost:4000';
const MIN_PAGES = 1;
const MAX_PAGES = 30;
const DEFAULT_PAGES = 5;

let status = {
  running: false, phase: 'idle', message: 'Prêt.',
  pages: 0, foundCount: 0, readCount: 0, unreadCount: 0, hasJobs: false,
};
let stopRequested = false;

// Le service worker peut être tué entre deux actions : on retrouve le
// dernier état (et les dernières offres collectées) au réveil pour qu'une
// popup rouverte n'affiche pas "Prêt." alors qu'une collecte a eu lieu.
chrome.storage.local.get(['status', 'lastJobs'], (r) => {
  if (r.status) status = { ...status, ...r.status, running: false };
  if (Array.isArray(r.lastJobs) && r.lastJobs.length) status.hasJobs = true;
});

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const humanPause = (min, max) => sleep(min + Math.random() * (max - min));

// Motif des erreurs qui signalent un blocage WTTJ (anti-bot / rate-limit),
// à distinguer d'une vraie 404 ou d'une annonce vide (pas de retry pour celles-là).
const BLOCKED_RE = /^HTTP (202|403|429)/;
const BACKOFF_WAITS_S = [30, 60, 120]; // secondes, un palier par retry

// Attend `seconds` secondes en dormant par pas de 1 s (garde le service worker
// réveillé — un setTimeout long seul ne suffit pas — et permet à « Arrêter »
// de couper l'attente rapidement) tout en affichant un compte à rebours.
async function backoffWait(seconds) {
  for (let s = seconds; s > 0 && !stopRequested; s--) {
    setStatus({ message: `Welcome to the Jungle limite les lectures : nouvel essai dans ${s} s…` });
    await sleep(1000);
  }
}

function setStatus(patch) {
  status = { ...status, ...patch };
  chrome.storage.local.set({ status });
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

// POSTe les offres vers l'Éditeur de CV avec des messages d'erreur clairs :
// serveur absent, ou serveur d'une ancienne version sans /jobs.
async function sendJobs(jobs) {
  let res;
  try {
    res = await fetch(`${APP_URL}/jobs`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ jobs }),
    });
  } catch {
    throw new Error('Serveur injoignable : lancez « node server.js » dans le dossier du projet.');
  }
  if (res.status === 404 || res.status === 405) {
    throw new Error('Le serveur lancé est une ancienne version sans /jobs : relancez node server.js depuis cette branche.');
  }
  if (!res.ok) throw new Error(`Erreur ${res.status}.`);
  return res.json();
}

// Ouvre l'Éditeur de CV sur le panneau « Offres collectées », ou recharge
// l'onglet déjà ouvert pour qu'il relise le nouvel envoi.
async function openOrFocusApp() {
  const target = `${APP_URL}/#offres`;
  try {
    const tabs = await chrome.tabs.query({ url: `${APP_URL}/*` });
    if (tabs.length) {
      await chrome.tabs.update(tabs[0].id, { url: target, active: true });
      await chrome.tabs.reload(tabs[0].id);
      await chrome.windows.update(tabs[0].windowId, { focused: true }).catch(() => {});
    } else {
      await chrome.tabs.create({ url: target });
    }
  } catch (err) {
    console.error('[openOrFocusApp]', err); // pas grave : l'utilisateur ouvrira l'app lui-même
  }
}

const readStats = (jobs) => {
  const readCount = jobs.filter((j) => j.description).length;
  return { readCount, unreadCount: jobs.length - readCount };
};

async function run(tabId, maxPagesRequested) {
  stopRequested = false;
  const found = new Map();
  const maxPages = Math.min(MAX_PAGES, Math.max(MIN_PAGES, Number(maxPagesRequested) || DEFAULT_PAGES));
  setStatus({
    running: true, phase: 'pages', message: 'Lecture de la page 1…',
    pages: 0, foundCount: 0, readCount: 0, unreadCount: 0, error: '',
  });

  try {
    // Extension installée après l'ouverture de l'onglet : on injecte le script.
    try { await chrome.tabs.sendMessage(tabId, { type: 'ping' }); } catch {
      await chrome.scripting.executeScript({ target: { tabId }, files: ['content.js'] });
    }

    // 1. Parcourt les pages de résultats, jusqu'à la limite choisie
    let prevFirst = null;
    for (let page = 1; page <= maxPages && !stopRequested; page++) {
      const { cards, changed } = await ask(tabId, { type: 'collect', prevFirst });
      if (page > 1 && !changed) break; // le clic n'a rien changé : dernière page
      cards.forEach((c) => found.has(c.url) || found.set(c.url, c));
      prevFirst = cards[0] && cards[0].url;
      setStatus({ pages: page, foundCount: found.size, message: `Page ${page} lue — ${found.size} offres trouvées.` });

      await humanPause(1500, 3000);
      if (stopRequested || page === maxPages) break; // limite atteinte : inutile de cliquer « suivant »
      const { clicked } = await ask(tabId, { type: 'next' });
      if (!clicked) break;
    }

    // 2. Ouvre chaque offre (en arrière-plan) pour lire l'annonce complète
    const jobs = [];
    const list = [...found.values()];
    setStatus({ phase: 'details' });
    for (let i = 0; i < list.length && !stopRequested; i++) {
      setStatus({ message: `Lecture des annonces : ${i + 1} / ${list.length}` });

      let detail = null;
      let lastErr = null;
      let retriesExhausted = false;
      // 1 essai initial + jusqu'à 3 retries si WTTJ bloque (202/403/429).
      // Les autres erreurs (404, annonce vide, erreur de messagerie) ne sont pas retryées.
      for (let attempt = 0; attempt < 1 + BACKOFF_WAITS_S.length; attempt++) {
        try {
          detail = await ask(tabId, { type: 'fetchJob', url: list[i].url });
          lastErr = null;
          break;
        } catch (err) {
          lastErr = err;
          if (!BLOCKED_RE.test(err.message) || stopRequested) break;
          if (attempt === BACKOFF_WAITS_S.length) { retriesExhausted = true; break; }
          await backoffWait(BACKOFF_WAITS_S[attempt]);
        }
      }

      if (lastErr) {
        jobs.push({ ...list[i], description: '', error: lastErr.message });
      } else {
        jobs.push({ ...list[i], ...Object.fromEntries(Object.entries(detail).filter(([, v]) => v)) });
      }
      setStatus(readStats(jobs));

      if (retriesExhausted) {
        // WTTJ continue de bloquer après 3 tentatives : inutile d'insister sur
        // les annonces suivantes, on les marque non lues et on envoie ce qu'on a.
        for (let j = i + 1; j < list.length; j++) {
          jobs.push({ ...list[j], description: '', error: lastErr.message });
        }
        setStatus({
          ...readStats(jobs),
          message: `Welcome to the Jungle a bloqué la lecture des annonces : réessayez plus tard (${readStats(jobs).readCount}/${list.length} lues).`,
        });
        break;
      }

      await humanPause(1500, 3000);
      if (!stopRequested && (i + 1) % 5 === 0 && i + 1 < list.length) {
        setStatus({ message: 'Pause de quelques secondes…' });
        await humanPause(8000, 15000);
      }
    }

    await chrome.storage.local.set({ lastJobs: jobs });
    setStatus({ hasJobs: jobs.length > 0 });

    // 3. Envoie le tout à l'Éditeur de CV (même partiel si on a arrêté)
    setStatus({ phase: 'sending', message: `Envoi de ${jobs.length} offres à l'Éditeur de CV…` });
    await sendJobs(jobs);
    const stats = readStats(jobs);
    // Dernière offre bloquée = lecture interrompue par WTTJ : on le garde visible
    const blocked = jobs.length > 0 && BLOCKED_RE.test(jobs[jobs.length - 1].error || '');
    setStatus({
      running: false, phase: 'done', sent: jobs.length, ...stats,
      message: `${jobs.length} offres envoyées (${stats.readCount} lues, ${stats.unreadCount} non lues).`
        + (blocked ? ' Welcome to the Jungle a bloqué la suite : réessayez plus tard.' : ''),
    });
    await openOrFocusApp();
  } catch (err) {
    setStatus({ running: false, phase: 'error', message: `Erreur : ${err.message}` });
  }
}

// Renvoie les dernières offres collectées (bouton « Envoyer » de la popup),
// sans refaire toute la collecte.
async function resend() {
  const { lastJobs = [] } = await chrome.storage.local.get('lastJobs');
  if (!lastJobs.length) {
    setStatus({ phase: 'error', message: 'Aucune offre à envoyer : lancez d’abord une collecte.' });
    return;
  }
  setStatus({ phase: 'sending', message: `Envoi de ${lastJobs.length} offres à l'Éditeur de CV…` });
  try {
    await sendJobs(lastJobs);
    const stats = readStats(lastJobs);
    setStatus({
      phase: 'done', sent: lastJobs.length, ...stats,
      message: `${lastJobs.length} offres envoyées (${stats.readCount} lues, ${stats.unreadCount} non lues).`,
    });
    await openOrFocusApp();
  } catch (err) {
    setStatus({ phase: 'error', message: `Erreur : ${err.message}` });
  }
}

chrome.runtime.onMessage.addListener((msg, _sender, reply) => {
  if (msg.type === 'start' && !status.running) run(msg.tabId, msg.maxPages);
  if (msg.type === 'stop') stopRequested = true;
  if (msg.type === 'send' && !status.running) resend();
  reply({ status });
});
