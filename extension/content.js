/* Script injecté dans les pages Welcome to the Jungle.
   Il ne décide rien : background.js lui envoie des ordres (collect, next,
   fetchJob) et il répond avec ce qu'il lit dans la page. */

if (!window.__wttjScraper) {
  window.__wttjScraper = true;

  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  // Une offre WTTJ a toujours une URL de la forme
  // /fr/companies/<entreprise>/jobs/<offre> : plus stable que les classes CSS.
  const JOB_PATH = /\/companies\/([^/]+)\/jobs\/[^/?#]+/;

  function readCards() {
    const seen = new Map();
    for (const a of document.querySelectorAll('a[href*="/jobs/"]')) {
      const url = new URL(a.href, location.href);
      const m = url.pathname.match(JOB_PATH);
      if (!m) continue;
      const key = url.origin + url.pathname;
      if (seen.has(key)) continue;
      const card = a.closest('li, article') || a;
      const heading = card.querySelector('h2, h3, h4');
      const title = ((heading && heading.innerText) || a.innerText || '').split('\n')[0].trim();
      seen.set(key, { url: key, title, company: m[1].replace(/-/g, ' ') });
    }
    return [...seen.values()];
  }

  // Attend que les offres apparaissent — et, après un changement de page,
  // qu'elles soient différentes de celles de la page précédente.
  async function collect(prevFirst) {
    for (let i = 0; i < 30; i++) {
      const cards = readCards();
      if (cards.length && cards[0].url !== prevFirst) return { cards, changed: true };
      await sleep(500);
    }
    return { cards: readCards(), changed: false };
  }

  const isDisabled = (n) => n.disabled || n.getAttribute('aria-disabled') === 'true';

  // Clique sur la page suivante de la pagination : d'abord le numéro
  // « page actuelle + 1 », sinon un bouton « Suivant ».
  function next() {
    const controls = [...document.querySelectorAll('nav a, nav button, [class*="agination"] a, [class*="agination"] button')];
    // WTTJ marque le lien actif avec aria-current="page" sur certaines pages,
    // "true" sur d'autres (vérifié en direct) : on accepte les deux.
    const current = controls.find((n) => ['page', 'true'].includes(n.getAttribute('aria-current')));
    const currentNum = Number((current && current.innerText.trim()) || new URL(location.href).searchParams.get('page') || 1);
    const target =
      controls.find((n) => n.innerText.trim() === String(currentNum + 1) && !isDisabled(n)) ||
      controls.find((n) => /suivant|next/i.test(n.getAttribute('aria-label') || n.innerText) && !isDisabled(n));
    if (!target) return { clicked: false };
    target.scrollIntoView({ block: 'center' });
    target.click();
    return { clicked: true };
  }

  function htmlToText(fragment) {
    const doc = new DOMParser().parseFromString(fragment, 'text/html');
    doc.querySelectorAll('br').forEach((n) => n.replaceWith('\n'));
    doc.querySelectorAll('p, div, li, h1, h2, h3, h4').forEach((n) => n.append('\n'));
    return (doc.body.textContent || '').split('\n').map((l) => l.trim()).filter(Boolean).join('\n');
  }

  function findJobPosting(value) {
    if (!value || typeof value !== 'object') return null;
    if (Array.isArray(value)) return value.map(findJobPosting).find(Boolean) || null;
    const types = [].concat(value['@type']);
    if (types.includes('JobPosting')) return value;
    return value['@graph'] ? findJobPosting(value['@graph']) : null;
  }

  // Lit la fiche complète d'une offre. La page expose un bloc JSON-LD
  // « JobPosting » (fait pour Google) : titre, entreprise, description.
  // Vérifié sur des pages WTTJ réelles : le JSON-LD contient la description complète ;
  // il n'y a pas de second JSON embarqué à côté (__INITIAL_STATE__ ne
  // contient que l'état de routage, pas l'offre). On extrait les blocs JSON-LD
  // par regex sur le HTML brut (évite de parser toute la page) et on ne parse le DOM complet qu'en repli,
  // si aucun JobPosting avec description n'a été trouvé.
  const LD_JSON_RE = /<script[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;

  async function fetchJob(url) {
    const res = await fetch(url, { credentials: 'include' });
    if (res.status === 202) throw new Error('HTTP 202'); // 202 = page anti-bot WTTJ, corps vide (sinon lu comme "Annonce vide")
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const html = await res.text();
    // matchAll repart du début à chaque appel (exec garderait la position de l'offre précédente)
    for (const match of html.matchAll(LD_JSON_RE)) {
      let posting;
      try { posting = findJobPosting(JSON.parse(match[1])); } catch { continue; }
      if (!posting) continue;
      const description = htmlToText(String(posting.description || ''));
      if (!description) continue; // bloc JobPosting sans description : on tente le suivant
      const loc = [].concat(posting.jobLocation || [])[0];
      return {
        title: String(posting.title || '').trim(),
        company: String((posting.hiringOrganization && posting.hiringOrganization.name) || '').trim(),
        location: String((loc && loc.address && loc.address.addressLocality) || '').trim(),
        description,
      };
    }
    // Repli sans JSON-LD (ou JSON-LD sans description) : le texte principal de la page,
    // via un parse complet du DOM (plus coûteux, mais rare).
    const doc = new DOMParser().parseFromString(html, 'text/html');
    doc.querySelectorAll('script, style, nav, header, footer').forEach((n) => n.remove());
    const main = doc.querySelector('main') || doc.body;
    const description = htmlToText(main.innerHTML);
    if (!description) throw new Error('Annonce vide : impossible de lire le contenu de cette page.');
    return { description };
  }

  chrome.runtime.onMessage.addListener((msg, _sender, reply) => {
    const run = {
      ping: async () => ({ ok: true }),
      collect: () => collect(msg.prevFirst),
      next: async () => next(),
      fetchJob: () => fetchJob(msg.url),
    }[msg.type];
    if (!run) return false;
    run().then(reply, (err) => reply({ error: err.message }));
    return true; // réponse asynchrone
  });
}
