/* Popup : prépare le prompt de recalibrage du CV pour l'offre WTTJ ouverte,
   puis le copie dans le presse-papiers. Pas d'arrière-plan : tout se passe
   pendant que la popup est ouverte. */

// KEEP 4000 ici : le port passera à 3333 seulement au merge (voir mémoire du projet).
const APP_URL = 'http://localhost:4000';

// Une offre WTTJ a toujours une URL de la forme /companies/<entreprise>/jobs/<offre>.
const JOB_URL_RE = /^https:\/\/www\.welcometothejungle\.com\/.*\/companies\/[^/]+\/jobs\/[^/?#]+/;

const copyBtn = document.getElementById('copyPromptBtn');
const statusEl = document.getElementById('status');
const hintEl = document.getElementById('hint');
const detailsEl = document.getElementById('promptDetails');
const promptEl = document.getElementById('prompt');

let currentPrompt = '';

function setStatus(message, isError = false) {
  statusEl.textContent = message;
  statusEl.classList.toggle('error', isError);
}

// Injecté dans l'onglet WTTJ : doit être autonome (executeScript le sérialise,
// aucune référence à une variable extérieure n'est possible).
async function extractJobFromPage() {
  const LD_JSON_RE = /<script[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;

  function findJobPosting(value) {
    if (!value || typeof value !== 'object') return null;
    if (Array.isArray(value)) return value.map(findJobPosting).find(Boolean) || null;
    const types = [].concat(value['@type']);
    if (types.includes('JobPosting')) return value;
    return value['@graph'] ? findJobPosting(value['@graph']) : null;
  }

  function htmlToText(fragment) {
    const doc = new DOMParser().parseFromString(fragment, 'text/html');
    doc.querySelectorAll('br').forEach((n) => n.replaceWith('\n'));
    doc.querySelectorAll('p, div, li, h1, h2, h3, h4').forEach((n) => n.append('\n'));
    return (doc.body.textContent || '').split('\n').map((l) => l.trim()).filter(Boolean).join('\n');
  }

  // WTTJ est une SPA : le DOM affiché peut dater d'une navigation interne
  // précédente. On recharge la page brute pour lire un JSON-LD à jour.
  let res;
  try {
    res = await fetch(location.href, { credentials: 'include' });
  } catch (err) {
    return { error: `Rechargement impossible : ${err.message}` };
  }
  if (res.status === 202) return { error: 'HTTP 202' }; // page anti-bot WTTJ
  if (!res.ok) return { error: `HTTP ${res.status}` };
  const html = await res.text();

  for (const match of html.matchAll(LD_JSON_RE)) {
    let posting;
    try { posting = findJobPosting(JSON.parse(match[1])); } catch { continue; }
    if (!posting) continue;
    const description = htmlToText(String(posting.description || ''));
    if (!description) continue; // bloc JobPosting sans description : on tente le suivant
    const loc = [].concat(posting.jobLocation || [])[0];
    return {
      url: location.href,
      title: String(posting.title || '').trim(),
      company: String((posting.hiringOrganization && posting.hiringOrganization.name) || '').trim(),
      location: String((loc && loc.address && loc.address.addressLocality) || '').trim(),
      description,
    };
  }

  // Repli sans JSON-LD exploitable : le texte principal du DOM vivant.
  const main = document.querySelector('main') || document.body;
  const description = (main.innerText || '').trim();
  if (!description) return { error: 'Annonce vide : impossible de lire le contenu de cette page.' };
  return { url: location.href, description };
}

// Injecté dans l'onglet de l'app (world MAIN) : appelle la fonction exposée
// par app.js, ou renvoie null si elle n'existe pas (vieille version de l'app,
// ou page pas encore chargée).
function callCvPromptForJob(job) {
  return window.cvPromptForJob ? window.cvPromptForJob(job) : null;
}

// Trouve un onglet déjà ouvert sur l'app, ou en ouvre un (inactif, pour que
// la popup ne se ferme pas), puis attend qu'il soit chargé.
async function findOrOpenAppTab() {
  const tabs = await chrome.tabs.query({ url: `${APP_URL}/*` });
  if (tabs.length) return tabs[0];
  const created = await chrome.tabs.create({ url: `${APP_URL}/`, active: false });
  for (let i = 0; i < 34; i += 1) { // ~10 s
    const t = await chrome.tabs.get(created.id);
    if (t.status === 'complete') return t;
    await new Promise((r) => setTimeout(r, 300));
  }
  return created;
}

const APP_UNREACHABLE = `Éditeur de CV injoignable : lancez « PORT=4000 node server.js » depuis ce dossier.`;

async function prepareTargetPrompt(job) {
  const tab = await findOrOpenAppTab();
  let lastResult = null;
  for (let i = 0; i < 34; i += 1) { // ~10 s, le temps qu'app.js s'exécute
    let execResult;
    try {
      [execResult] = await chrome.scripting.executeScript({
        target: { tabId: tab.id },
        world: 'MAIN',
        func: callCvPromptForJob,
        args: [job],
      });
    } catch {
      execResult = null;
    }
    lastResult = execResult && execResult.result;
    if (lastResult) break;
    await new Promise((r) => setTimeout(r, 300));
  }
  if (!lastResult) throw new Error(APP_UNREACHABLE);
  if (lastResult.error) throw new Error(lastResult.error);
  return lastResult;
}

async function copyPrompt() {
  if (!currentPrompt) return;
  try {
    await navigator.clipboard.writeText(currentPrompt);
    const label = copyBtn.textContent;
    copyBtn.textContent = 'Prompt copié ✓';
    setStatus('Collez-le dans votre assistant IA, puis recollez sa réponse dans l’Éditeur de CV.');
    setTimeout(() => { copyBtn.textContent = label; }, 2000);
  } catch {
    detailsEl.open = true;
    promptEl.focus();
    promptEl.select();
    setStatus('Copie automatique refusée par le navigateur : sélectionnez le texte ci-dessus et copiez-le à la main.', true);
  }
}

copyBtn.addEventListener('click', copyPrompt);

(async () => {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!JOB_URL_RE.test((tab && tab.url) || '')) {
    hintEl.textContent = 'Ouvrez une offre Welcome to the Jungle.';
    setStatus('Cette page n’est pas une offre Welcome to the Jungle.', true);
    copyBtn.disabled = true;
    return;
  }

  setStatus('Préparation du prompt…');
  try {
    const [{ result: job }] = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: extractJobFromPage,
    });
    if (!job || job.error) {
      const err = job && job.error;
      const message = err === 'HTTP 202'
        ? 'Welcome to the Jungle a bloqué la lecture de cette page : réessayez plus tard.'
        : `Impossible de lire cette offre${err ? ` (${err})` : ''}.`;
      setStatus(message, true);
      return;
    }
    const prompt = await prepareTargetPrompt(job);
    currentPrompt = prompt;
    promptEl.value = prompt;
    copyBtn.disabled = false;
    setStatus('Prompt prêt.');
  } catch (err) {
    setStatus(`Erreur : ${err.message}`, true);
  }
})();
