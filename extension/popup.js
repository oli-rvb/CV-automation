/* Popup : prépare le prompt d'adaptation du CV pour l'offre WTTJ ouverte,
   puis le copie dans le presse-papiers. Pas d'arrière-plan : tout se passe
   pendant que la popup est ouverte. */

const APP_URL = 'http://localhost:3333';

// Une offre WTTJ a toujours une URL de la forme /companies/<entreprise>/jobs/<offre>.
const JOB_URL_RE = /^https:\/\/www\.welcometothejungle\.com\/.*\/companies\/[^/]+\/jobs\/[^/?#]+/;

// À incrémenter en même temps que window.cvPromptVersion dans app.js : permet
// de détecter un onglet app resté ouvert sur une ancienne version (le prompt
// qu'elle renverrait serait alors périmé) et de le recharger avant usage.
const PROMPT_VERSION = 2;

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

  // Convertit un noeud DOM déjà présent dans la page (on clone pour ne pas
  // la modifier) en texte, une ligne par titre/paragraphe/item de liste.
  function nodeToText(root) {
    const clone = root.cloneNode(true);
    clone.querySelectorAll('br').forEach((n) => n.replaceWith('\n'));
    clone.querySelectorAll('p, div, li, h1, h2, h3, h4').forEach((n) => n.append('\n'));
    return (clone.textContent || '').split('\n').map((l) => l.trim()).filter(Boolean).join('\n');
  }

  function htmlToText(fragment) {
    const doc = new DOMParser().parseFromString(fragment, 'text/html');
    return nodeToText(doc.body);
  }

  // Les 3 blocs de la fiche de poste WTTJ qu'on veut vraiment (le JSON-LD ne
  // couvre que le premier). Identifiés par data-testid : plus stable que les
  // classes styled-components hashées (elles changent à chaque redéploiement).
  const SECTION_TESTIDS = ['job-section-description', 'job-section-experience', 'job-section-process'];
  // Repli si WTTJ change ses data-testid : la div englobante observée manuellement.
  const LEGACY_CLASS_SELECTOR = '.sc-ddHBHQ.iDagxD';

  function extractFromDoc(root) {
    const parts = SECTION_TESTIDS
      .map((id) => root.querySelector(`[data-testid="${id}"]`))
      .filter(Boolean)
      .map(nodeToText)
      .filter(Boolean);
    if (parts.length) return parts.join('\n\n');
    const legacy = root.querySelector(LEGACY_CLASS_SELECTOR);
    return legacy ? nodeToText(legacy) : '';
  }

  function jobPostingFromLiveDoc() {
    for (const s of document.querySelectorAll('script[type="application/ld+json"]')) {
      let posting;
      try { posting = findJobPosting(JSON.parse(s.textContent)); } catch { continue; }
      if (posting) return posting;
    }
    return null;
  }

  function jobPostingFromHtml(html) {
    for (const match of html.matchAll(LD_JSON_RE)) {
      let posting;
      try { posting = findJobPosting(JSON.parse(match[1])); } catch { continue; }
      if (posting) return posting;
    }
    return null;
  }

  function postingFields(posting) {
    const loc = [].concat(posting.jobLocation || [])[0];
    return {
      title: String(posting.title || '').trim(),
      company: String((posting.hiringOrganization && posting.hiringOrganization.name) || '').trim(),
      location: String((loc && loc.address && loc.address.addressLocality) || '').trim(),
    };
  }

  // Le DOM vivant correspond-il bien à l'URL courante ? WTTJ est une SPA :
  // après une navigation interne (changement d'offre sans rechargement), le
  // DOM ou son JSON-LD peuvent encore décrire l'offre précédente le temps que
  // React termine son re-render. Le <link rel="canonical"> est mis à jour par
  // le routeur à chaque changement d'offre et se compare en une ligne : c'est
  // le contrôle le plus simple et le moins coûteux. S'il est absent, on
  // recoupe avec un titre visible (h1/h2) qui doit correspondre au titre JSON-LD.
  function liveDomIsFresh(title) {
    const canonical = document.querySelector('link[rel="canonical"]');
    if (canonical) {
      try { return new URL(canonical.href).pathname === location.pathname; } catch { /* URL invalide : on retombe sur le titre */ }
    }
    if (!title) return false;
    return [...document.querySelectorAll('h1, h2')].some((h) => h.textContent.trim() === title);
  }

  // 1) Chemin rapide : tout depuis le DOM déjà chargé, sans requête réseau ni
  // parsing HTML complet — c'est le cas courant (popup ouverte sur la page).
  const livePosting = jobPostingFromLiveDoc();
  const liveFields = livePosting ? postingFields(livePosting) : null;
  const liveDescription = extractFromDoc(document);
  if (liveDescription && liveDomIsFresh(liveFields && liveFields.title)) {
    return {
      url: location.href,
      title: (liveFields && liveFields.title) || '',
      company: (liveFields && liveFields.company) || '',
      location: (liveFields && liveFields.location) || '',
      description: liveDescription,
    };
  }

  // 2) Repli : DOM vivant absent ou périmé. On recharge la page brute pour
  // lire un contenu à jour.
  let res;
  try {
    res = await fetch(location.href, { credentials: 'include' });
  } catch (err) {
    return { error: `Rechargement impossible : ${err.message}` };
  }
  if (res.status === 202) return { error: 'HTTP 202' }; // page anti-bot WTTJ
  if (!res.ok) return { error: `HTTP ${res.status}` };
  const html = await res.text();

  // Titre/entreprise/lieu par regex d'abord (pas besoin de parser tout le
  // HTML pour ça) ; le DOMParser ne sert plus qu'à retrouver les sections.
  const fetchedPosting = jobPostingFromHtml(html);
  const fetchedFields = fetchedPosting ? postingFields(fetchedPosting) : null;
  const fetchedDoc = new DOMParser().parseFromString(html, 'text/html');

  // Description : 1) sections stables dans le HTML rechargé, 2) description
  // JSON-LD (peut manquer Profil recherché / entretiens), 3) texte brut de
  // <main> en dernier repli.
  let description = extractFromDoc(fetchedDoc);

  if (!description && fetchedPosting) {
    description = htmlToText(String(fetchedPosting.description || ''));
  }

  if (!description) {
    const main = document.querySelector('main') || document.body;
    description = (main.innerText || '').trim();
  }

  if (!description) return { error: 'Annonce vide : impossible de lire le contenu de cette page.' };
  return {
    url: location.href,
    title: (fetchedFields && fetchedFields.title) || '',
    company: (fetchedFields && fetchedFields.company) || '',
    location: (fetchedFields && fetchedFields.location) || '',
    description,
  };
}

// Injecté dans l'onglet de l'app (world MAIN) : lit uniquement la version du
// prompt, sans effet de bord, pour décider s'il faut recharger l'onglet.
function readCvPromptVersion() {
  return window.cvPromptVersion;
}

// Injecté dans l'onglet de l'app (world MAIN) : appelle la fonction exposée
// par app.js (ou renvoie result: null si elle n'existe pas encore — page pas
// chargée) et renvoie sa version en même temps, pour vérifier pendant le
// sondage qu'on parle toujours à la bonne version après un rechargement.
function callCvPromptForJob(job) {
  return {
    version: window.cvPromptVersion,
    result: window.cvPromptForJob ? window.cvPromptForJob(job) : null,
  };
}

async function getTabPromptVersion(tabId) {
  try {
    const [{ result }] = await chrome.scripting.executeScript({
      target: { tabId }, world: 'MAIN', func: readCvPromptVersion,
    });
    return result;
  } catch {
    return undefined;
  }
}

// Trouve un onglet déjà ouvert sur l'app, ou en ouvre un (inactif, pour que
// la popup ne se ferme pas), puis attend qu'il soit chargé.
async function findOrOpenAppTab() {
  const tabs = await chrome.tabs.query({ url: `${APP_URL}/*` });
  if (tabs.length) return { tab: tabs[0], isNew: false };
  const created = await chrome.tabs.create({ url: `${APP_URL}/`, active: false });
  for (let i = 0; i < 34; i += 1) { // ~10 s
    const t = await chrome.tabs.get(created.id);
    if (t.status === 'complete') return { tab: t, isNew: true };
    await new Promise((r) => setTimeout(r, 300));
  }
  return { tab: created, isNew: true };
}

const APP_UNREACHABLE = `Éditeur de CV injoignable : lancez « node server.js » depuis ce dossier.`;
const APP_OUTDATED = `L'Éditeur de CV ouvert n'est pas à jour : relancez « node server.js » depuis ce dossier et rechargez l'extension.`;

async function prepareTargetPrompt(job) {
  const { tab, isNew } = await findOrOpenAppTab();
  // Onglet déjà ouvert : il a pu être chargé avant un changement de prompt
  // dans app.js. On le recharge seulement si sa version est périmée, pour ne
  // pas perturber l'utilisateur inutilement (state persisté en localStorage,
  // donc rien n'est perdu — voir save() dans app.js).
  if (!isNew && (await getTabPromptVersion(tab.id)) !== PROMPT_VERSION) {
    await chrome.tabs.reload(tab.id);
  }
  let lastResult = null;
  let versionOk = false;
  for (let i = 0; i < 34; i += 1) { // ~10 s, le temps qu'app.js s'exécute (ou se recharge)
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
    const payload = execResult && execResult.result;
    versionOk = !!payload && payload.version === PROMPT_VERSION;
    lastResult = versionOk ? payload.result : null;
    if (lastResult) break;
    await new Promise((r) => setTimeout(r, 300));
  }
  if (!versionOk) throw new Error(APP_OUTDATED);
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
    setStatus('Collez-le dans votre assistant IA, puis collez sa réponse JSON dans « Partir de votre CV existant » de l’Éditeur de CV.');
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
