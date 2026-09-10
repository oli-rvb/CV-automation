'use strict';

/* ============================================================
   Éditeur de CV — état, versions, modèles, drag & drop, analyse
   ============================================================ */

const LS_KEY = 'cv-editor-data-v1';

const uid = () => Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4);

/* ---------- Couleur du bandeau (modèle « design ») ---------- */

// Repli défensif : pdf.js est chargé avant app.js et fournit ces valeurs.
const SIDE_BG_DEFAULT = window.CV_SIDE_BG_DEFAULT || '#1f3a5f';

// Teintes sobres proposées dans la barre d'outils
const SIDE_PRESETS = [
  { name: 'Bleu nuit', hex: '#1f3a5f' },
  { name: 'Ardoise', hex: '#3f4c5a' },
  { name: 'Vert profond', hex: '#1f4d3d' },
  { name: 'Bordeaux', hex: '#6b2733' },
  { name: 'Prune', hex: '#4a2d4e' },
  { name: 'Anthracite', hex: '#2f3237' },
];

const SIDE_HEX_RE = /^#(?:[0-9a-f]{3}|[0-9a-f]{6})$/i;

/* N'accepte qu'un code hex ; toute autre valeur (ancienne sauvegarde sans
   couleur, JSON trafiqué…) retombe sur la couleur par défaut. La valeur
   n'est donc jamais injectée telle quelle dans une propriété CSS. */
function normalizeSideColor(v) {
  return normalizeHexColor(v, SIDE_BG_DEFAULT);
}

// Idem, mais avec repli paramétrable (couleur des titres, etc.).
function normalizeHexColor(v, fallback) {
  if (typeof v !== 'string') return fallback;
  const s = v.trim().toLowerCase();
  if (!SIDE_HEX_RE.test(s)) return fallback;
  // Forme canonique sur 6 chiffres
  return s.length === 4 ? `#${s[1]}${s[1]}${s[2]}${s[2]}${s[3]}${s[3]}` : s;
}

/* ---------- Couleur des titres du CV ----------
   Trois modes : « bandeau » (même couleur que le bandeau), « complement »
   (teinte opposée du bandeau, défaut) ou « custom » (couleur libre). Le calcul
   effectif est dans pdf.js (window.cvTitleColorHex), partagé avec le PDF. */
const TITLE_COLOR_DEFAULT = '#2563eb'; // bleu d'accent, couleur de départ en mode « custom »
const TITLE_MODES = ['bandeau', 'complement', 'custom'];
const normalizeTitleMode = (v) => (TITLE_MODES.includes(v) ? v : 'complement');

/* ---------- Tailles de police ---------- */

// Table des rôles réglables (défauts, variables CSS, tailles dérivées) :
// définie dans pdf.js, qui l'utilise aussi pour le PDF de secours.
const FONT_ROLES = window.CV_FONT_ROLES;
const FONT_BOUNDS = window.CV_FONT_BOUNDS || { min: 6, max: 40 };

// Intitulé de chaque zone réglable, selon le modèle. Le modèle « pro » n'a
// qu'une colonne : ses réglages ne sont pas coiffés d'un intitulé de zone.
const FONT_ZONE_LABELS = {
  pro: { main: '' },
  design: { side: 'Bandeau (gauche)', main: 'Colonne principale (droite)' },
};

// Ne conserve que les rôles réglables (les tailles dérivées sont recalculées
// à chaque rendu) et ramène toute valeur douteuse à son défaut.
function normalizeFontSizes(v) {
  const src = v && typeof v === 'object' ? v : {};
  const out = {};
  for (const [tpl, zones] of Object.entries(FONT_ROLES)) {
    out[tpl] = {};
    for (const [zone, roles] of Object.entries(zones)) {
      const from = (src[tpl] && src[tpl][zone]) || {};
      const vals = {};
      for (const r of roles) vals[r.key] = window.cvClampFontSize(from[r.key], r.def);
      out[tpl][zone] = vals;
    }
  }
  return out;
}

// Ancien bloc « email · téléphone · ville » en une seule ligne : coupe au
// mieux pour retomber sur des champs Email / Téléphone / Adresse.
function splitContact(contact) {
  const parts = (contact || '').split('·').map((s) => s.trim()).filter(Boolean);
  let email = '';
  let phone = '';
  const rest = [];
  for (const p of parts) {
    if (!email && /@/.test(p)) email = p;
    else if (!phone && /^[+\d][\d\s().-]{5,}$/.test(p)) phone = p;
    else rest.push(p);
  }
  return { email, phone, address: rest.join(' · ') };
}

// Le contact est une liste de champs libres (comme les liens) : { id, label, value }.
// Compatibilité avec les deux formats antérieurs : { email, phone, address }
// (3 champs fixes) puis, avant ça, un unique champ texte { contact: '...' }.
function normalizeContact(p, base) {
  if (Array.isArray(p.contact)) {
    return p.contact.map((c) => ({
      id: (c && c.id) || uid(),
      label: String((c && c.label) ?? ''),
      value: String((c && c.value) ?? ''),
    }));
  }
  const fromFields = [];
  if (p.email) fromFields.push({ id: uid(), label: 'Email', value: String(p.email) });
  if (p.phone) fromFields.push({ id: uid(), label: 'Téléphone', value: String(p.phone) });
  if (p.address) fromFields.push({ id: uid(), label: 'Adresse', value: String(p.address) });
  if (fromFields.length) return fromFields;

  if (typeof p.contact === 'string' && p.contact.trim()) {
    const { email, phone, address } = splitContact(p.contact);
    const items = [];
    if (email) items.push({ id: uid(), label: 'Email', value: email });
    if (phone) items.push({ id: uid(), label: 'Téléphone', value: phone });
    if (address) items.push({ id: uid(), label: 'Adresse', value: address });
    if (items.length) return items;
  }

  return base.profile.contact;
}

// Partie « CV courant » de l'état (ce qui est capturé dans une version)
function defaultCV() {
  return {
    profile: {
      name: 'Prénom Nom',
      title: 'Intitulé du poste recherché',
      contact: [
        { id: uid(), label: 'Email', value: 'prenom.nom@email.fr' },
        { id: uid(), label: 'Téléphone', value: '06 00 00 00 00' },
        { id: uid(), label: 'Adresse', value: 'Ville' },
      ],
      summary: "Contenu d'exemple : cliquez sur n'importe quel texte pour le modifier. " +
        'Réorganisez les tirets par glisser-déposer (poignée ⠿) ou avec les flèches, ' +
        'et collez une offre d’emploi dans le panneau de droite pour obtenir un ordre suggéré.',
      photo: '',
      // Original conservé (réduit) + transformation, pour re-recadrer plus tard.
      photoSrc: '',
      photoCrop: null,
      links: [
        { id: uid(), label: 'Portfolio', url: 'monportfolio.fr' },
        { id: uid(), label: 'GitHub', url: 'github.com/pseudo' },
        { id: uid(), label: 'LinkedIn', url: 'linkedin.com/in/pseudo' },
      ],
    },
    template: 'pro',
    sideColor: SIDE_BG_DEFAULT,
    titleColorMode: 'complement',
    titleColor: TITLE_COLOR_DEFAULT,
    fontSizes: normalizeFontSizes(null),
    experiences: [
      {
        id: uid(),
        role: 'Chef de projet digital',
        company: 'Agence Lumen, Paris',
        period: '2022 – aujourd’hui',
        companyDescription:
          'Lorem ipsum dolor sit amet, consectetur adipiscing elit, sed do eiusmod tempor incididunt.',
        bullets: [
          { id: uid(), text: 'Pilotage de 8 projets web simultanés (budget cumulé 600 k€), de la conception à la mise en production' },
          { id: uid(), text: 'Management d’une équipe de 5 développeurs et 2 designers en méthode agile (Scrum)' },
          { id: uid(), text: 'Mise en place d’un tableau de bord de suivi ayant réduit les retards de livraison de 30 %' },
          { id: uid(), text: 'Relation client : animation des comités de pilotage et rédaction des propositions commerciales' },
        ],
      },
      {
        id: uid(),
        role: 'Développeur web',
        company: 'StartupXYZ, Lyon',
        period: '2019 – 2022',
        companyDescription:
          'Lorem ipsum dolor sit amet, consectetur adipiscing elit, sed do eiusmod tempor incididunt.',
        bullets: [
          { id: uid(), text: 'Développement d’applications web en JavaScript (React, Node.js) et Python' },
          { id: uid(), text: 'Conception d’API REST et intégration de services tiers (paiement, CRM)' },
          { id: uid(), text: 'Automatisation des tests et du déploiement (CI/CD), couverture de tests portée à 80 %' },
          { id: uid(), text: 'Participation aux entretiens techniques et accompagnement de 3 développeurs juniors' },
        ],
      },
    ],
    education: [
      {
        id: uid(),
        title: 'Master Informatique',
        detail: 'Université de Lyon (2019)',
        bullets: [
          { id: uid(), text: 'Spécialisation développement web et architectures cloud' },
          { id: uid(), text: 'Projet de fin d’études : plateforme de mise en relation freelances/clients' },
        ],
      },
      { id: uid(), title: 'Licence Informatique', detail: 'Université de Lyon (2017)', bullets: [] },
    ],
    projects: [
      {
        id: uid(),
        title: 'Refonte du site vitrine d’une PME',
        detail: 'React et Node.js (2023)',
        bullets: [
          { id: uid(), text: 'Développement front-end React et back-end Node.js' },
          { id: uid(), text: '40 % de trafic en plus après la mise en ligne' },
        ],
      },
      {
        id: uid(),
        title: 'Générateur de CV open source',
        detail: 'JavaScript sans dépendance (2022)',
        bullets: [{ id: uid(), text: '300 étoiles sur GitHub' }],
      },
    ],
    skills: 'JavaScript, React, Node.js, Python, SQL · Gestion de projet, Scrum · Anglais courant',
    // Sous-groupes de compétences : un intitulé (« Langues », « Outils »…)
    // suivi d'un texte libre, qui peut tenir sur plusieurs lignes.
    skillGroups: [
      { id: uid(), label: 'Langues', text: 'Anglais : courant\nEspagnol : notions' },
      { id: uid(), label: 'Outils', text: 'Gestion de projet\nSuite bureautique' },
      {
        id: uid(),
        label: 'Informatique',
        text: 'IA : assistants de code\nGestion de projet : suivi de tâches\nDonnées : tableaux de bord\nLangages : SQL, Python, Web\nDesign : maquettage, tableau blanc\nBureautique : suites collaboratives',
      },
    ],
    interests: [
      { id: uid(), text: 'Bénévolat associatif' },
      { id: uid(), text: 'Sport (course à pied)' },
      { id: uid(), text: 'Écologie : animation d\'ateliers de sensibilisation, soutien à une association' },
      { id: uid(), text: 'Électronique (projets personnels)' },
      { id: uid(), text: 'Impression 3D (création de pièces techniques)' },
      { id: uid(), text: 'Musique (pratique instrumentale)' },
    ],
    jobText: '',
  };
}

function defaultState() {
  return { ...defaultCV(), versions: [], activeVersionId: null, proposal: null, rewrite: null, activeTab: 'create', recentColors: [] };
}

/* ---------- Chargement / sauvegarde ---------- */

function normalizeBullets(list) {
  return (Array.isArray(list) ? list : []).map((b) =>
    typeof b === 'string' ? { id: uid(), text: b } : { id: (b && b.id) || uid(), text: String((b && b.text) ?? '') }
  );
}

// Coupe une ancienne ligne « Titre — Détail » (avant la scission en deux
// champs) : tout avant le premier « — » devient le titre.
function splitLine(id, text) {
  const idx = text.indexOf(' — ');
  return idx === -1
    ? { id, title: text.trim(), detail: '' }
    : { id, title: text.slice(0, idx).trim(), detail: text.slice(idx + 3).trim() };
}

// Sous-sections titre + détail + points (formation, projets) : même forme
// qu'une expérience, sans période. { id, title, detail, bullets }
function normalizeSubsections(list) {
  return (Array.isArray(list) ? list : []).map((e) => {
    if (typeof e === 'string') return { ...splitLine(uid(), e), bullets: [] };
    const id = (e && e.id) || uid();
    if (e && (typeof e.title === 'string' || typeof e.detail === 'string')) {
      return { id, title: String(e.title ?? ''), detail: String(e.detail ?? ''), bullets: normalizeBullets(e.bullets) };
    }
    // Sauvegarde antérieure à la scission titre/détail : { id, text }
    return { ...splitLine(id, String((e && e.text) ?? '')), bullets: [] };
  });
}

function normalizeCV(data) {
  const base = defaultCV();
  data = data && typeof data === 'object' ? data : {};
  const p = data.profile && typeof data.profile === 'object' ? data.profile : {};

  const cv = {
    profile: {
      name: typeof p.name === 'string' ? p.name : base.profile.name,
      title: typeof p.title === 'string' ? p.title : base.profile.title,
      contact: normalizeContact(p, base),
      summary: typeof p.summary === 'string' ? p.summary : base.profile.summary,
      photo: typeof p.photo === 'string' ? p.photo : '',
      photoSrc: typeof p.photoSrc === 'string' ? p.photoSrc : '',
      photoCrop:
        p.photoCrop && typeof p.photoCrop === 'object'
          ? {
              s: Number(p.photoCrop.s) || 0,
              ox: Number(p.photoCrop.ox) || 0,
              oy: Number(p.photoCrop.oy) || 0,
            }
          : null,
      links: (Array.isArray(p.links) ? p.links : base.profile.links).map((l) => ({
        id: (l && l.id) || uid(),
        label: String((l && l.label) ?? ''),
        url: String((l && l.url) ?? ''),
      })),
    },
    template: data.template === 'design' ? 'design' : 'pro',
    sideColor: normalizeSideColor(data.sideColor),
    titleColorMode: normalizeTitleMode(data.titleColorMode),
    titleColor: normalizeHexColor(data.titleColor, TITLE_COLOR_DEFAULT),
    // Tailles de police : propres au CV, donc voyagent avec les CV sauvegardés.
    fontSizes: normalizeFontSizes(data.fontSizes),
    experiences: (Array.isArray(data.experiences) ? data.experiences : []).map((e) => ({
      id: e.id || uid(),
      role: String(e.role ?? ''),
      company: String(e.company ?? ''),
      period: String(e.period ?? ''),
      companyDescription: String(e.companyDescription ?? ''),
      bullets: normalizeBullets(e.bullets),
    })),
    education: normalizeSubsections(data.education),
    // Sauvegardes antérieures à la section « Projets » : pas de clé `projects`.
    // On repart d'une liste vide plutôt que des exemples, pour ne jamais
    // injecter de faux contenu dans un CV réel déjà rempli.
    projects: normalizeSubsections(data.projects),
    skills: typeof data.skills === 'string' ? data.skills : '',
    // Comme `projects` : une sauvegarde antérieure à ces sections repart d'une
    // liste vide, jamais des exemples du modèle.
    skillGroups: (Array.isArray(data.skillGroups) ? data.skillGroups : []).map((g) => ({
      id: (g && g.id) || uid(),
      label: String((g && g.label) ?? ''),
      text: String((g && g.text) ?? ''),
    })),
    interests: (Array.isArray(data.interests) ? data.interests : []).map((it) =>
      typeof it === 'string' ? { id: uid(), text: it } : { id: (it && it.id) || uid(), text: String((it && it.text) ?? '') }
    ),
    jobText: typeof data.jobText === 'string' ? data.jobText : '',
  };
  return cv;
}

// Couche de relecture (variante « semi-auto ») : les lignes d'expérience
// recalibrées sur une offre, appliquées d'un bloc. Comme la proposition
// d'ordre, c'est une SURCOUCHE D'AFFICHAGE — le CV de base garde son texte,
// qui reste toujours accessible en désactivant une ligne.
//
//   { createdAt, versionId, name, lang, jobText, entries: { [expId]: [entry] } }
//   entry = { id, kind: 'edit', bulletId, before, after, active }
//         | { id, kind: 'add',                before: '', after, active }
//
// `before` est le texte du CV de base au moment de l'application : il ne sert
// qu'à afficher le diff. Annuler une ligne ne réécrit rien, cela repasse
// simplement l'affichage sur le tiret du CV de base (toujours à jour).
function normalizeRewrite(data, experiences) {
  if (!data || typeof data !== 'object') return null;
  const known = new Set(experiences.map((e) => e.id));
  const entries = {};
  const src = data.entries && typeof data.entries === 'object' ? data.entries : {};
  for (const [expId, list] of Object.entries(src)) {
    if (!known.has(expId) || !Array.isArray(list)) continue;
    const exp = experiences.find((e) => e.id === expId);
    const bulletIds = new Set(exp.bullets.map((b) => b.id));
    const kept = [];
    for (const e of list) {
      if (!e || typeof e !== 'object') continue;
      const after = String(e.after ?? '');
      // Une ligne recalibrée vidée à la main reste une ligne de la relecture :
      // seule une ligne AJOUTÉE vide n'a plus d'objet.
      if (e.kind === 'add' && !after.trim()) continue;
      if (e.kind === 'add') {
        kept.push({ id: String(e.id || uid()), kind: 'add', bulletId: null, before: '', after, active: e.active !== false });
      } else if (typeof e.bulletId === 'string' && bulletIds.has(e.bulletId)) {
        kept.push({
          id: String(e.id || uid()),
          kind: 'edit',
          bulletId: e.bulletId,
          before: String(e.before ?? ''),
          after,
          active: e.active !== false,
        });
      }
    }
    if (kept.length) entries[expId] = kept;
  }
  if (Object.keys(entries).length === 0) return null;
  return {
    createdAt: Number(data.createdAt) || Date.now(),
    versionId: typeof data.versionId === 'string' ? data.versionId : null,
    name: String(data.name || ''),
    lang: data.lang === 'en' ? 'en' : 'fr',
    jobText: typeof data.jobText === 'string' ? data.jobText : '',
    entries,
  };
}

function normalizeState(data) {
  const s = normalizeCV(data);
  s.versions = (Array.isArray(data.versions) ? data.versions : []).map((v) => ({
    id: (v && v.id) || uid(),
    name: String((v && v.name) || 'Version sans nom'),
    createdAt: (v && v.createdAt) || Date.now(),
    data: normalizeCV(v && v.data),
  }));
  s.activeVersionId = typeof data.activeVersionId === 'string' ? data.activeVersionId : null;
  // Proposition en cours : l'ordre PROPOSÉ des tirets, par expérience. Le CV
  // de base (s.experiences) n'est jamais réordonné par l'analyse : la
  // proposition n'est qu'une surcouche d'ordre, affichée dans l'onglet
  // « Nouveau CV » et enregistrable comme CV sauvegardé.
  s.proposal = null;
  const p = data.proposal;
  if (p && typeof p === 'object' && p.orders && typeof p.orders === 'object') {
    const orders = {};
    for (const [expId, ids] of Object.entries(p.orders)) {
      if (Array.isArray(ids)) orders[expId] = ids.map(String);
    }
    if (Object.keys(orders).length > 0) s.proposal = { orders };
  }
  s.rewrite = normalizeRewrite(data.rewrite, s.experiences);
  s.activeTab = data.activeTab === 'base' ? 'base' : 'create';
  // Dernières couleurs libres utilisées (pipette), de la plus récente à la
  // plus ancienne. On ne garde que des hex valides, dédoublonnés, 5 au plus.
  const seen = new Set();
  s.recentColors = (Array.isArray(data.recentColors) ? data.recentColors : [])
    .filter((v) => typeof v === 'string' && SIDE_HEX_RE.test(v.trim()))
    .map(normalizeSideColor)
    .filter((hex) => !seen.has(hex) && seen.add(hex))
    .slice(0, 5);
  return s;
}

function loadState() {
  try {
    const raw = localStorage.getItem(LS_KEY);
    if (!raw) return defaultState();
    const data = JSON.parse(raw);
    if (!data || typeof data !== 'object' || !data.profile || !Array.isArray(data.experiences)) {
      return defaultState();
    }
    return normalizeState(data);
  } catch {
    return defaultState();
  }
}

function save() {
  try {
    localStorage.setItem(LS_KEY, JSON.stringify(state));
  } catch {
    /* stockage indisponible : l'édition reste possible dans la page */
  }
  updateSaveIndicator();
}

let state = loadState();

/* ---------- Petits utilitaires DOM ---------- */

const $ = (sel) => document.querySelector(sel);

function el(tag, attrs = {}, ...children) {
  const n = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v === undefined || v === null) continue;
    if (k === 'class') n.className = v;
    else if (k === 'text') n.textContent = v;
    else if (k === 'contenteditable') n.contentEditable = v;
    else n.setAttribute(k, v);
  }
  for (const c of children) if (c !== undefined && c !== null && c !== false) n.append(c);
  return n;
}

function focusEnd(node) {
  node.focus();
  const range = document.createRange();
  range.selectNodeContents(node);
  range.collapse(false);
  const sel = window.getSelection();
  sel.removeAllRanges();
  sel.addRange(range);
}

const cvEl = $('#cv');
const cvScaleEl = $('#cvScale');
const resultsEl = $('#results');
const jobTextEl = $('#jobText');
const versionListEl = $('#versionList');
const versionNameEl = $('#versionName');
const overflowNoticeEl = $('#overflowNotice');
const pageCountEl = $('#pageCount');
const photoFileEl = $('#photoFile');

let pendingFocusBulletId = null;

/* ---------- Mise à l'échelle du CV (onglet « Nouveau CV ») ----------

   Le CV garde toujours sa largeur INTERNE de 210mm (même mise en page,
   mêmes retours à la ligne qu'à taille réelle et dans le PDF exporté) : seul
   son rendu visuel est réduit par transform: scale, pour remplir le cadre
   #cvScale — dont la largeur suit celle de sa colonne de grille. Voir
   styles.css pour le reste (le sélecteur qui applique le transform ne matche
   que dans l'onglet « Nouveau CV »). */

// 210mm en pixels CSS : conversion fixe (96px = 1in = 25.4mm), indépendante
// de la résolution physique de l'écran — la même valeur que .sheet { width: 210mm }.
const CV_MM_PX = (210 * 96) / 25.4;

function updateCvScale() {
  if (!cvScaleEl || !inCreateTab()) {
    if (cvScaleEl) cvScaleEl.style.setProperty('--cv-scale', '1');
    return;
  }
  const w = cvScaleEl.getBoundingClientRect().width;
  if (w <= 0) return; // cadre pas encore mis en page (ex. onglet masqué)
  cvScaleEl.style.setProperty('--cv-scale', String(Math.min(1, w / CV_MM_PX)));
}

/* ---------- Dépassement d'une page (modèle « design ») ----------

   La feuille du modèle design fait exactement 297 mm et coupe ce qui dépasse
   (styles.css) : sans cet avis, quelques lignes de trop disparaîtraient du CV
   et du PDF sans que rien ne l'indique. `scrollHeight` mesure le contenu réel
   de la colonne principale, `clientHeight` la place disponible. */
function updateOverflowNotice() {
  if (!overflowNoticeEl) return;
  // Les deux colonnes sont des éléments de grille : elles s'étirent avec leur
  // contenu et débordent de la feuille, qui, elle, reste à 297 mm. On compare
  // donc leur hauteur à la place offerte par la feuille, pas à la leur.
  let excess = 0;
  if (state.template === 'design') {
    const room = cvEl.clientHeight;
    for (const col of cvEl.querySelectorAll('.main, .side')) {
      excess = Math.max(excess, col.scrollHeight - room);
    }
  }
  // Deux pixels de marge : les arrondis sous-pixels ne doivent pas alarmer.
  if (excess <= 2) {
    overflowNoticeEl.hidden = true;
    return;
  }
  const mm = Math.max(1, Math.round((excess * 25.4) / 96));
  overflowNoticeEl.textContent =
    `Le contenu dépasse la page d'environ ${mm} mm : le bas est coupé sur le CV comme dans le PDF. ` +
    'Raccourcissez un tiret, supprimez une entrée ou réduisez une taille de texte.';
  overflowNoticeEl.hidden = false;
}

// ---------- Aperçu paginé du modèle « pro » ----------
// Le modèle « pro » peut dépasser une page A4. À l'écran la feuille est un flux
// continu ; pour la faire lire comme des pages A4 successives, on insère avant
// chaque bloc qui déborderait un « saut de page » : il comble le bas de la page
// courante, puis matérialise la marge basse, une gouttière (couleur du fond du
// site) et la marge haute de la page suivante — si bien que le bloc repart en
// haut de la page d'après, marges comprises. Ces cales sont purement visuelles
// (masquées à l'impression, voir @media print) : le PDF, lui, reste paginé par
// Chrome. Tout est en pixels CSS (96 px = 25,4 mm), comme .sheet { width:210mm }.
const MM_PX = 96 / 25.4;
const A4_PAGE_PX = 297 * MM_PX;
const PAGE_MARGIN_PX = 10 * MM_PX; // marges haut/bas d'une page (= padding vertical de .sheet)
const PAGE_GUTTER_PX = 14; // gouttière visible entre deux pages
const PAGE_PRINTABLE_PX = A4_PAGE_PX - 2 * PAGE_MARGIN_PX;

function paginatePro() {
  // Repartir propre : on retire les cales de la passe précédente.
  cvEl.querySelectorAll('.cv-page-break').forEach((n) => n.remove());
  if (state.template === 'design') return 1;

  const kids = [...cvEl.children];
  if (kids.length === 0) return 1;
  // Positions NATURELLES (offsetTop/offsetHeight : hauteurs de mise en page, non
  // affectées par le scale visuel du cadre) mesurées AVANT toute insertion.
  const tops = kids.map((k) => k.offsetTop);
  const heights = kids.map((k) => k.offsetHeight);
  const start = tops[0];
  let pageBottom = start + PAGE_PRINTABLE_PX; // bas de la zone de contenu de la page courante
  const breaks = [];
  for (let i = 1; i < kids.length; i++) {
    if (tops[i] + heights[i] > pageBottom + 0.5) {
      breaks.push({ node: kids[i], fill: Math.max(0, pageBottom - tops[i]) });
      pageBottom = tops[i] + PAGE_PRINTABLE_PX;
    }
  }
  for (const b of breaks) {
    const sp = document.createElement('div');
    sp.className = 'cv-page-break';
    const g0 = b.fill + PAGE_MARGIN_PX; // début de la gouttière (après marge basse)
    const g1 = g0 + PAGE_GUTTER_PX; // fin de la gouttière (avant marge haute)
    sp.style.height = `${g1 + PAGE_MARGIN_PX}px`;
    // Gouttière seule (couleur du fond), sur TOUTE la largeur de la cale — qui
    // déborde des bords de la feuille — pour masquer, à hauteur de gouttière,
    // l'ombre latérale de .sheet qui relierait sinon les deux pages.
    sp.style.background =
      `linear-gradient(to bottom, transparent 0, transparent ${g0}px,` +
      ` var(--bg) ${g0}px, var(--bg) ${g1}px, transparent ${g1}px)`;
    // Bord bas de la page du dessus : une barre à la lèvre de la gouttière portant
    // le MÊME box-shadow que .sheet, pour que l'ombre du bas soit identique à
    // celles de gauche/droite (voir .cv-page-edge, ramenée à la largeur de page).
    const edge = document.createElement('div');
    edge.className = 'cv-page-edge';
    edge.style.height = `${g0}px`; // du haut de la cale jusqu'à la lèvre de la gouttière : bord bas de la page du dessus
    sp.appendChild(edge);
    // Coins haut de la page du dessous (voir .cv-page-edge-top) : positionnés à
    // la fin de la gouttière, c'est-à-dire au tout début du blanc de la page suivante.
    const edgeTop = document.createElement('div');
    edgeTop.className = 'cv-page-edge-top';
    edgeTop.style.top = `${g1}px`; // haut de la page du dessous (fin de gouttière)
    sp.appendChild(edgeTop);
    cvEl.insertBefore(sp, b.node);
  }
  return breaks.length + 1;
}

function updatePageCount() {
  if (!pageCountEl) return;
  if (state.template === 'design') {
    pageCountEl.hidden = true;
    return;
  }
  const pages = cvEl.querySelectorAll('.cv-page-break').length + 1;
  pageCountEl.textContent =
    pages === 1
      ? 'Ce CV tient sur 1 page A4.'
      : `Ce CV occupera ${pages} pages A4, affichées séparément sur la feuille.`;
  pageCountEl.hidden = false;
}

// Deux déclencheurs redondants (l'un des deux suffit à chaque navigateur) :
// ResizeObserver réagit à tout changement de taille du CADRE lui-même
// (redimensionnement de fenêtre, rotation d'écran, ouverture des outils de
// dev…), y compris quand il n'est pas causé par un resize de la fenêtre ;
// `resize` couvre les navigateurs ou contextes où l'observation du cadre ne
// se déclenche pas. `updateCvScale` est idempotente : l'appeler deux fois
// pour un même changement ne pose aucun problème.
if (cvScaleEl && typeof ResizeObserver === 'function') {
  new ResizeObserver(updateCvScale).observe(cvScaleEl);
}
window.addEventListener('resize', updateCvScale);

/* ============================================================
   Rendu du CV
   ============================================================ */

function iconBtn(label, action, title, extraClass = '') {
  return el('button', {
    class: `icon-btn ${extraClass}`.trim(),
    type: 'button',
    'data-action': action,
    title,
    'aria-label': title,
    text: label,
  });
}

/* ---------- Blocs réutilisés par les deux modèles ---------- */

function photoBlock() {
  const box = el('div', { class: 'photo-box' });
  if (state.profile.photo) {
    box.append(
      el('img', { class: 'cv-photo', src: state.profile.photo, alt: 'Photo de profil' }),
      el(
        'div',
        { class: 'photo-controls' },
        iconBtn('✎', 'photo-set', 'Changer la photo'),
        iconBtn('✕', 'photo-del', 'Supprimer la photo', 'del')
      )
    );
  } else {
    box.append(el('button', { class: 'photo-placeholder', type: 'button', 'data-action': 'photo-set', text: '+ Photo' }));
  }
  return box;
}

// Préfixe un schéma par défaut (comme pdf.js) : « monsite.fr » devient un
// href valide sans que l'utilisateur ait à taper « https:// ».
function linkHref(url) {
  const u = (url || '').trim();
  if (!u) return null;
  return /^[a-z][a-z0-9+.-]*:/i.test(u) ? u : 'https://' + u;
}

// Vrais liens hypertextes : la ligne affiche un texte libre (« Portfolio »,
// « LinkedIn »…) et c'est ce texte qui est cliquable — dans le navigateur
// comme dans le PDF, où le recruteur atteint la page en un clic. L'URL cible
// n'est pas écrite sur le CV : elle se règle par le bouton 🔗.
function linksBlock() {
  const wrap = el('div', { class: 'cv-links' });
  state.profile.links.forEach((l) => {
    const href = linkHref(l.url);
    wrap.append(
      el(
        'div',
        { class: 'link-item', 'data-link-id': l.id },
        el(
          'a',
          {
            class: 'link-url',
            contenteditable: 'true',
            'data-lfield': 'label',
            href: href || undefined,
            target: '_blank',
            rel: 'noopener noreferrer',
            title: href ? `Ouvrir ${href}` : 'Aucune adresse : cliquez sur 🔗 pour en définir une',
          },
          // Anciennes données sans intitulé : l'URL sert de texte affiché.
          l.label || l.url
        ),
        el(
          'div',
          { class: 'bullet-controls' },
          iconBtn('🔗', 'link-url', "Modifier l'adresse du lien"),
          iconBtn('✕', 'link-del', 'Supprimer le lien', 'del')
        )
      )
    );
  });
  wrap.append(el('button', { class: 'add-link', type: 'button', 'data-action': 'link-add', text: '+ Ajouter un lien' }));
  return wrap;
}

function nameEl() {
  return el('div', { class: 'cv-name', contenteditable: 'true', 'data-bind': 'name' }, state.profile.name);
}

function titleEl() {
  return el('div', { class: 'cv-title', contenteditable: 'true', 'data-bind': 'title' }, state.profile.title);
}

// Modèle « pro » : nom et titre restent groupés en tête du CV.
function nameBlock() {
  return [nameEl(), titleEl()];
}

// Liste libre de champs (email, téléphone, adresse…), comme les liens : une
// valeur éditable par ligne, ajout et suppression libres. Pas d'intitulé
// affiché — un email ou un numéro se reconnaissent d'eux-mêmes. Le champ
// `label` reste dans les données (imports antérieurs, export JSON).
function contactBlock() {
  const wrap = el('div', { class: 'cv-contact-block' });
  state.profile.contact.forEach((c) => {
    wrap.append(
      el(
        'div',
        { class: 'contact-item', 'data-contact-id': c.id },
        el('span', { class: 'contact-value', contenteditable: 'true', 'data-cfield': 'value' }, c.value),
        el('div', { class: 'bullet-controls' }, iconBtn('✕', 'contact-del', 'Supprimer le champ', 'del'))
      )
    );
  });
  wrap.append(el('button', { class: 'add-contact', type: 'button', 'data-action': 'contact-add', text: '+ Ajouter un champ' }));
  return wrap;
}

function summaryBlock() {
  return el('div', { class: 'cv-summary', contenteditable: 'true', 'data-bind': 'summary' }, state.profile.summary);
}

function skillsBlock() {
  return el('div', { class: 'cv-skills', contenteditable: 'true', 'data-bind': 'skills' }, state.skills);
}

// Champ éditable sur plusieurs lignes : les sauts de ligne du texte deviennent
// des <br>, et l'état se relit avec innerText (textContent les perdrait).
function fillMultiline(node, text) {
  String(text ?? '')
    .split('\n')
    .forEach((line, i) => {
      if (i > 0) node.append(el('br'));
      node.append(document.createTextNode(line));
    });
  return node;
}

function multilineField(className, field, text) {
  return fillMultiline(
    el('div', { class: className, contenteditable: 'true', 'data-multiline': '', 'data-gfield': field }),
    text
  );
}

// Sous-groupes de compétences : intitulé en gras + texte libre multiligne,
// affichés à la suite du bloc « Compétences » dans les deux modèles.
function skillGroupsBlock() {
  const wrap = el('div', { class: 'cv-skill-groups' });
  state.skillGroups.forEach((g) => {
    wrap.append(
      el(
        'div',
        { class: 'skill-group', 'data-group-id': g.id },
        el('div', { class: 'skill-group-label', contenteditable: 'true', 'data-gfield': 'label' }, g.label),
        multilineField('skill-group-text', 'text', g.text),
        el('div', { class: 'bullet-controls' }, iconBtn('✕', 'group-del', 'Supprimer ce groupe', 'del'))
      )
    );
  });
  wrap.append(
    el('button', { class: 'add-group', type: 'button', 'data-action': 'group-add', text: '+ Ajouter un groupe' })
  );
  return wrap;
}

// Centres d'intérêt : une entrée par ligne (elle-même multiligne si besoin).
function interestsBlock() {
  const wrap = el('div', { class: 'cv-interests' });
  state.interests.forEach((it) => {
    wrap.append(
      el(
        'div',
        { class: 'interest-item', 'data-interest-id': it.id },
        multilineField('interest-text', 'interest', it.text),
        el('div', { class: 'bullet-controls' }, iconBtn('✕', 'interest-del', 'Supprimer cet intérêt', 'del'))
      )
    );
  });
  wrap.append(
    el('button', { class: 'add-interest', type: 'button', 'data-action': 'interest-add', text: '+ Ajouter un intérêt' })
  );
  return wrap;
}

function sectionTitle(text, side = false) {
  return el('div', { class: side ? 'side-title' : 'cv-section-title', text });
}

/* ---------- Onglets « Nouveau CV » / « CV de base » ---------- */

function inCreateTab() {
  return state.activeTab !== 'base';
}

// Ordre proposé pour une expérience (null hors proposition). Le tableau
// renvoyé est CELUI de l'état : le modifier (drag & drop, flèches…) modifie
// la proposition, jamais le CV de base.
function proposalOrderFor(ownerId) {
  return (state.proposal && state.proposal.orders[ownerId]) || null;
}

// Tirets d'une expérience dans l'ordre AFFICHÉ : l'ordre proposé dans
// l'onglet « Nouveau CV » (tirets ajoutés depuis l'analyse en fin de liste),
// l'ordre du CV de base partout ailleurs.
function displayBullets(exp) {
  const order = inCreateTab() ? proposalOrderFor(exp.id) : null;
  if (!order) return applyRewriteLayer(exp, exp.bullets);
  const byId = new Map(exp.bullets.map((b) => [b.id, b]));
  const out = [];
  for (const id of order) {
    const b = byId.get(id);
    if (b) {
      out.push(b);
      byId.delete(id);
    }
  }
  out.push(...byId.values());
  return applyRewriteLayer(exp, out);
}

// Badge de diff d'un tiret de la proposition : compare sa position affichée à
// sa position dans le CV de base. Rendu uniquement au survol du CV (voir
// styles.css) et jamais dans le PDF.
function diffBadge(bulletId, index, ownerId) {
  if (!ownerId || !inCreateTab() || !proposalOrderFor(ownerId)) return null;
  const exp = findExp(ownerId);
  const baseIdx = exp ? exp.bullets.findIndex((b) => b.id === bulletId) : -1;
  if (baseIdx === -1 || baseIdx === index) return null;
  const arrow = baseIdx > index ? '↑' : '↓';
  return el('span', {
    class: 'diff-badge',
    title: 'Position dans le CV de base',
    text: `${arrow} était n°${baseIdx + 1}`,
  });
}

// Liste de points réordonnable, partagée par les expériences, la formation
// et les projets (l'identité du propriétaire se retrouve via ownerFromSection,
// pas via un attribut sur le <ul> lui-même). `ownerId` n'est fourni que pour
// les expériences : il sert au diff avec le CV de base pendant une proposition.
// Badge de relecture : dit d'un coup d'œil qu'un tiret a été recalibré (avec
// le texte du CV de base en infobulle) ou qu'il a été ajouté — ou, prioritaire
// sur les deux, qu'il contient un chiffre introuvable dans le CV de base.
// Même vie que le badge d'ordre : visible au survol du CV seulement, donc
// jamais imprimé.
function rewriteBadge(b) {
  if (!b.rw) return null;
  if (b.rwNumAlert) {
    return el('span', {
      class: 'rw-badge rw-badge-numalert',
      title: 'Chiffre introuvable dans le CV de base — à vérifier avant d’exporter.',
      text: `⚠ ${b.rwNumAlert > 1 ? b.rwNumAlert + ' chiffres' : '1 chiffre'} à vérifier`,
    });
  }
  return el('span', {
    class: 'rw-badge rw-badge-' + b.rw,
    title: b.rw === 'add' ? 'Ligne ajoutée par la relecture' : `Texte du CV de base : ${b.rwBefore}`,
    text: b.rw === 'add' ? '+ ajoutée' : '↻ réécrite',
  });
}

function bulletsUl(bullets, ownerId) {
  const ul = el('ul', { class: 'bullets' });
  // Dernier tiret réordonnable : les lignes ajoutées par la relecture ferment
  // la liste sans en faire partie, le ↓ du tiret qui les précède n'a donc rien
  // à déplacer.
  const lastMovable = bullets.reduce((acc, b, k) => (b.rw === 'add' ? acc : k), -1);
  bullets.forEach((b, j) => {
    const badge = diffBadge(b.id, j, ownerId);
    const rwBadge = rewriteBadge(b);
    // Une ligne ajoutée par la relecture n'existe pas dans le CV de base :
    // elle ne se réordonne pas (le ✕ la retire de la relecture).
    const added = b.rw === 'add';
    ul.append(
      el(
        'li',
        { class: 'bullet' + (badge ? ' moved' : '') + (b.rw ? ' rw-' + b.rw : '') + (b.rwNumAlert ? ' rw-numalert' : ''), 'data-bullet-id': b.id },
        !added && el('span', { class: 'drag-handle', title: 'Glisser pour réordonner', text: '⠿' }),
        el('span', { class: 'bullet-dot', text: '•' }),
        el('div', { class: 'bullet-text', contenteditable: 'true', 'data-bullet-id': b.id }, b.text),
        (badge || rwBadge) && el('span', { class: 'bullet-badges' }, rwBadge, badge),
        el(
          'div',
          { class: 'bullet-controls' },
          !added && j > 0 && iconBtn('↑', 'bullet-up', 'Monter le point'),
          !added && j < lastMovable && iconBtn('↓', 'bullet-down', 'Descendre le point'),
          iconBtn('✕', 'bullet-del', added ? 'Retirer cette ligne ajoutée' : 'Supprimer le point', 'del')
        )
      )
    );
  });
  return ul;
}

function experiencesBlock() {
  // Enveloppe (titre + expériences + bouton d'ajout) dans un conteneur : c'est
  // lui, et non tout le CV, qui déclenche l'apparition du « + Ajouter une
  // expérience » au survol (voir la règle de scoping par section dans styles.css).
  const frag = el('section', { class: 'cv-block' });
  frag.append(sectionTitle('Expériences professionnelles'));
  state.experiences.forEach((exp, i) => {
    const controls = el(
      'div',
      { class: 'exp-controls' },
      i > 0 && iconBtn('↑', 'exp-up', 'Monter l’expérience'),
      i < state.experiences.length - 1 && iconBtn('↓', 'exp-down', 'Descendre l’expérience'),
      iconBtn('✕', 'exp-del', 'Supprimer l’expérience', 'del')
    );

    const head = el(
      'div',
      { class: 'exp-head' },
      el(
        'div',
        {},
        el('span', { class: 'exp-role', contenteditable: 'true', 'data-field': 'role' }, exp.role),
        ' — ',
        el('span', { class: 'exp-company', contenteditable: 'true', 'data-field': 'company' }, exp.company)
      ),
      el('span', { class: 'exp-period', contenteditable: 'true', 'data-field': 'period' }, exp.period)
    );

    const companyDesc = el(
      'div',
      { class: 'exp-company-desc', contenteditable: 'true', 'data-field': 'companyDescription' },
      exp.companyDescription
    );

    frag.append(
      el(
        'section',
        { class: 'exp', 'data-exp-id': exp.id },
        controls,
        head,
        companyDesc,
        bulletsUl(displayBullets(exp), exp.id),
        el('button', { class: 'add-bullet', type: 'button', 'data-action': 'bullet-add', text: '+ Ajouter un tiret' })
      )
    );
  });
  frag.append(el('button', { class: 'add-exp', type: 'button', 'data-action': 'exp-add', text: '+ Ajouter une expérience' }));
  return frag;
}

// Sous-sections titre + détail + points (formation, projets) : même structure
// et mêmes classes qu'une expérience (exp / exp-head / exp-role / exp-company),
// sans période ni réordonnancement de l'élément lui-même.
function subsectionsBlock(title, items, kind, addLabel, side = false) {
  // Même conteneur que les expériences : le bouton d'ajout ne se révèle qu'au
  // survol de ce bloc (voir styles.css).
  const frag = el('section', { class: 'cv-block' });
  frag.append(sectionTitle(title, side));
  items.forEach((it) => {
    const controls = el('div', { class: 'exp-controls' }, iconBtn('✕', `${kind}-del`, 'Supprimer', 'del'));

    const head = el(
      'div',
      { class: 'exp-head' },
      el(
        'div',
        {},
        el('span', { class: 'exp-role', contenteditable: 'true', 'data-field': 'title' }, it.title),
        ' — ',
        el('span', { class: 'exp-company', contenteditable: 'true', 'data-field': 'detail' }, it.detail)
      )
    );

    frag.append(
      el(
        'section',
        { class: 'exp', [`data-${kind}-id`]: it.id },
        controls,
        head,
        bulletsUl(it.bullets),
        el('button', { class: 'add-bullet', type: 'button', 'data-action': 'bullet-add', text: '+ Ajouter un point' })
      )
    );
  });
  frag.append(el('button', { class: `add-${kind}`, type: 'button', 'data-action': `${kind}-add`, text: addLabel }));
  return frag;
}

function educationBlock(side = false) {
  return subsectionsBlock('Formation', state.education, 'edu', '+ Ajouter une formation', side);
}

function projectsBlock(side = false) {
  return subsectionsBlock('Projets', state.projects, 'project', '+ Ajouter un projet', side);
}

/* ---------- Les deux modèles ---------- */

function renderPro() {
  cvEl.append(
    el(
      'div',
      { class: 'cv-header' },
      el('div', { class: 'cv-header-main' }, ...nameBlock(), contactBlock(), linksBlock()),
      photoBlock()
    ),
    summaryBlock(),
    experiencesBlock(),
    educationBlock(),
    projectsBlock(),
    sectionTitle('Compétences'),
    skillsBlock(),
    skillGroupsBlock(),
    sectionTitle('Intérêts'),
    interestsBlock()
  );
}

function renderDesign() {
  // Nom sous la photo dans le bandeau ; le titre reste en tête de la colonne
  // principale, au-dessus du résumé.
  const side = el(
    'aside',
    { class: 'side' },
    photoBlock(),
    nameEl(),
    sectionTitle('Contact', true),
    contactBlock(),
    sectionTitle('Liens', true),
    linksBlock(),
    sectionTitle('Compétences', true),
    // Pas de skillsBlock() ici : dans le bandeau, les compétences ne
    // s'écrivent que par groupes intitulés. Le texte libre `skills` reste
    // éditable dans le modèle « pro ».
    skillGroupsBlock(),
    sectionTitle('Intérêts', true),
    interestsBlock()
  );
  // Formation et Projets vivent dans la colonne principale : la barre latérale
  // ne garde que photo, nom, Contact, Liens et Compétences.
  const main = el(
    'div',
    { class: 'main' },
    titleEl(),
    summaryBlock(),
    experiencesBlock(),
    educationBlock(),
    projectsBlock()
  );
  // La colonne principale d'abord dans le DOM : le texte du PDF (impression ou
  // backend) est extrait dans l'ordre du document — le placement visuel
  // (barre à gauche) est fixé par la grille CSS.
  cvEl.append(main, side);
}

/* Applique la couleur du bandeau à la feuille.

   Les variables sont posées EN LIGNE sur .sheet, et non sur :root : c'est
   `cvEl.outerHTML` qui est envoyé au backend PDF (server.js), donc la couleur
   voyage avec le HTML sans traitement supplémentaire côté serveur.
   styles.css redérive le reste (--side-ink, filets, anneau) par color-mix. */
function applySideColor() {
  const pal = window.cvSidePalette(state.sideColor);
  cvEl.style.setProperty('--side-bg', pal.bgHex);
  cvEl.style.setProperty('--side-fg', pal.fgHex);
}

// Couleur des titres : posée EN LIGNE sur .sheet (comme --side-bg) pour voyager
// avec cvEl.outerHTML (backend PDF, impression). Le PDF vectoriel la recalcule
// de son côté via cvTitleColorRgb — même source, même résultat.
function applyTitleColor() {
  cvEl.style.setProperty('--title-color', window.cvTitleColorHex(state));
}

/* Applique les tailles de police choisies à la feuille.

   Même principe que la couleur du bandeau : les variables sont posées EN LIGNE
   sur .sheet, donc elles voyagent avec `cvEl.outerHTML` vers le backend PDF et
   valent aussi à l'impression. styles.css n'a plus que des `var(--fs-…, X)` ;
   les valeurs de repli X restent les tailles d'origine.

   Toutes les variables connues sont d'abord effacées : les deux modèles n'ont
   pas les mêmes réglages, et une valeur du modèle précédent traînerait sinon. */
function applyFontSizes() {
  for (const zones of Object.values(FONT_ROLES)) {
    for (const roles of Object.values(zones)) {
      for (const r of roles) {
        cvEl.style.removeProperty(r.cssVar);
        for (const d of r.derived || []) cvEl.style.removeProperty(d.cssVar);
      }
    }
  }
  const tpl = fontTemplate();
  const sizes = window.cvFontSizes(state.fontSizes[tpl], tpl);
  for (const [zone, roles] of Object.entries(FONT_ROLES[tpl])) {
    for (const r of roles) {
      cvEl.style.setProperty(r.cssVar, `${sizes[zone][r.key]}px`);
      for (const d of r.derived || []) cvEl.style.setProperty(d.cssVar, `${sizes[zone][d.key]}px`);
    }
  }
}

function renderCV() {
  cvEl.textContent = '';
  cvEl.classList.toggle('design', state.template === 'design');
  applySideColor();
  applyTitleColor();
  applyFontSizes();
  if (state.template === 'design') renderDesign();
  else renderPro();

  if (pendingFocusBulletId) {
    const target = cvEl.querySelector(`.bullet-text[data-bullet-id="${pendingFocusBulletId}"]`);
    pendingFocusBulletId = null;
    if (target) focusEnd(target);
  }
}

function updateTemplateToggle() {
  $('#tplPro').classList.toggle('active', state.template === 'pro');
  $('#tplDesign').classList.toggle('active', state.template === 'design');
}

/* ---------- Contrôle de couleur du bandeau ---------- */

const sideSwatchesEl = $('#sideSwatches');

// Pastilles prédéfinies, construites une fois depuis SIDE_PRESETS
for (const preset of SIDE_PRESETS) {
  const b = el('button', {
    type: 'button',
    class: 'swatch',
    'data-hex': preset.hex,
    title: preset.name,
    'aria-label': preset.name,
    style: `--swatch:${preset.hex}`,
  });
  sideSwatchesEl.append(b);
}

sideSwatchesEl.addEventListener('click', (e) => {
  const b = e.target.closest('.swatch');
  if (!b) return;
  setSideColor(b.dataset.hex);
});

const recentSwatchesEl = $('#recentSwatches');

recentSwatchesEl.addEventListener('click', (e) => {
  const b = e.target.closest('.swatch');
  if (!b) return;
  // Réutiliser une couleur récente la remonte en tête de la liste
  rememberColor(b.dataset.hex);
  setSideColor(b.dataset.hex);
});

/* ----- Encadré « couleur libre » ouvert par la pipette -----

   Sélecteur maison (le sélecteur natif du navigateur ne peut pas accueillir
   de bouton OK) : zone de nuances saturation/luminosité, curseur de teinte,
   champs R/G/B, pipette d'écran via l'API EyeDropper quand elle existe.
   La couleur s'applique au CV en direct ; « OK » la mémorise et ferme. */

const pipetteBtnEl = $('#pipetteBtn');
const colorPopoverEl = $('#colorPopover');
const cpSvEl = $('#cpSv');
const cpSvCursorEl = $('#cpSvCursor');
const cpHueEl = $('#cpHue');
const cpPreviewEl = $('#cpPreview');
const cpREl = $('#cpR');
const cpGEl = $('#cpG');
const cpBEl = $('#cpB');
const cpHexEl = $('#cpHex');

// Conversions hex ↔ RGB ↔ HSV (h∈[0,360], s,v∈[0,1])
function hexToRgb(hex) {
  const h = normalizeSideColor(hex);
  return { r: parseInt(h.slice(1, 3), 16), g: parseInt(h.slice(3, 5), 16), b: parseInt(h.slice(5, 7), 16) };
}

function rgbToHex({ r, g, b }) {
  const c = (n) => Math.max(0, Math.min(255, Math.round(n))).toString(16).padStart(2, '0');
  return `#${c(r)}${c(g)}${c(b)}`;
}

function rgbToHsv({ r, g, b }) {
  r /= 255; g /= 255; b /= 255;
  const max = Math.max(r, g, b);
  const d = max - Math.min(r, g, b);
  let h = 0;
  if (d > 0) {
    if (max === r) h = 60 * (((g - b) / d) % 6);
    else if (max === g) h = 60 * ((b - r) / d + 2);
    else h = 60 * ((r - g) / d + 4);
  }
  return { h: (h + 360) % 360, s: max === 0 ? 0 : d / max, v: max };
}

function hsvToRgb({ h, s, v }) {
  const f = (n) => {
    const k = (n + h / 60) % 6;
    return 255 * (v - v * s * Math.max(0, Math.min(k, 4 - k, 1)));
  };
  return { r: f(5), g: f(3), b: f(1) };
}

/* Teinte/saturation/luminosité courantes du sélecteur. Gardées à part de
   state.sideColor : l'hex ne conserve pas la teinte d'un gris ni d'un noir,
   le curseur resterait sinon collé à gauche pendant le réglage. */
const cp = { h: 0, s: 0, v: 0 };

// Redessine tout le sélecteur depuis `cp` (curseurs, aperçu, champs R/G/B)
function refreshPicker() {
  const rgb = hsvToRgb(cp);
  const hex = rgbToHex(rgb);
  // Posée sur l'encadré : la zone de nuances ET la poignée de teinte l'utilisent
  colorPopoverEl.style.setProperty('--cp-hue', String(cp.h));
  cpSvCursorEl.style.left = `${cp.s * 100}%`;
  cpSvCursorEl.style.top = `${(1 - cp.v) * 100}%`;
  cpSvCursorEl.style.background = hex;
  cpHueEl.value = String(Math.round(cp.h));
  cpPreviewEl.style.background = hex;
  cpREl.value = String(Math.round(rgb.r));
  cpGEl.value = String(Math.round(rgb.g));
  cpBEl.value = String(Math.round(rgb.b));
  // Ne pas écraser le champ HEX pendant que l'utilisateur y tape
  if (document.activeElement !== cpHexEl) cpHexEl.value = hex;
}

// Applique `cp` au CV (aperçu en direct) et redessine le sélecteur
function applyPicker() {
  refreshPicker();
  setSideColor(rgbToHex(hsvToRgb(cp)));
}

// Aligne le sélecteur sur une couleur venue de l'extérieur (état, pipette d'écran)
function syncPickerFromHex(hex) {
  Object.assign(cp, rgbToHsv(hexToRgb(hex)));
  refreshPicker();
}

// Zone de nuances : glisser-déposer à la souris ou au doigt
cpSvEl.addEventListener('pointerdown', (e) => {
  cpSvEl.setPointerCapture(e.pointerId);
  const move = (ev) => {
    const r = cpSvEl.getBoundingClientRect();
    cp.s = Math.max(0, Math.min(1, (ev.clientX - r.left) / r.width));
    cp.v = 1 - Math.max(0, Math.min(1, (ev.clientY - r.top) / r.height));
    applyPicker();
  };
  move(e);
  cpSvEl.addEventListener('pointermove', move);
  cpSvEl.addEventListener('pointerup', () => cpSvEl.removeEventListener('pointermove', move), { once: true });
});

cpHueEl.addEventListener('input', () => {
  cp.h = Number(cpHueEl.value);
  applyPicker();
});

for (const input of [cpREl, cpGEl, cpBEl]) {
  input.addEventListener('input', () => {
    const num = (elx) => Math.max(0, Math.min(255, Number(elx.value) || 0));
    Object.assign(cp, rgbToHsv({ r: num(cpREl), g: num(cpGEl), b: num(cpBEl) }));
    applyPicker();
  });
}

/* Champ HEX : appliqué dès que la saisie forme un code valide (3 ou 6
   chiffres, « # » facultatif) ; complété/normalisé en quittant le champ */
cpHexEl.addEventListener('input', () => {
  const raw = cpHexEl.value.trim().replace(/^#?/, '#');
  if (!SIDE_HEX_RE.test(raw)) return;
  const hex = normalizeSideColor(raw);
  Object.assign(cp, rgbToHsv(hexToRgb(hex)));
  applyPicker();
});
cpHexEl.addEventListener('blur', () => refreshPicker());
cpHexEl.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') cpHexEl.blur();
});

// Pipette d'écran : API EyeDropper (Chrome/Edge) ; bouton masqué ailleurs
const cpEyedropBtnEl = $('#cpEyedropBtn');
if (typeof window.EyeDropper === 'function') {
  cpEyedropBtnEl.addEventListener('click', async () => {
    try {
      const { sRGBHex } = await new window.EyeDropper().open();
      syncPickerFromHex(sRGBHex);
      setSideColor(sRGBHex);
    } catch {
      /* prélèvement annulé (Échap) : on ne change rien */
    }
  });
} else {
  cpEyedropBtnEl.hidden = true;
}

function toggleColorPopover(open) {
  colorPopoverEl.hidden = !open;
  pipetteBtnEl.setAttribute('aria-expanded', String(open));
  // À l'ouverture, le sélecteur repart de la couleur courante du bandeau
  if (open) syncPickerFromHex(state.sideColor);
}

pipetteBtnEl.addEventListener('click', () => {
  toggleColorPopover(colorPopoverEl.hidden);
});

/* « OK » : valide la couleur courante, la mémorise dans les dernières
   utilisées et referme l'encadré. La mémorisation est volontairement
   manuelle, pour ne pas remplir les récentes de teintes intermédiaires. */
$('#sideColorOkBtn').addEventListener('click', () => {
  rememberColor(state.sideColor);
  toggleColorPopover(false);
  updateSideColorControl();
  save();
});

// L'encadré se referme (sans mémoriser) d'un clic ailleurs ou avec Échap
document.addEventListener('pointerdown', (e) => {
  if (colorPopoverEl.hidden) return;
  if (colorPopoverEl.contains(e.target) || pipetteBtnEl.contains(e.target)) return;
  toggleColorPopover(false);
});
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && !colorPopoverEl.hidden) toggleColorPopover(false);
});

function setSideColor(hex) {
  state.sideColor = normalizeSideColor(hex);
  applySideColor();
  // Les titres suivent le bandeau dans les modes « bandeau » et « complément ».
  applyTitleColor();
  updateSideColorControl();
  save();
}

/* Mémorise une couleur en tête des « dernières utilisées » (5 au plus).
   Les teintes de la palette fixe n'y sont pas dupliquées : elles ont déjà
   leur pastille permanente. */
function rememberColor(hex) {
  const c = normalizeSideColor(hex);
  if (SIDE_PRESETS.some((p) => p.hex === c)) return;
  state.recentColors = [c, ...state.recentColors.filter((x) => x !== c)].slice(0, 5);
}

function renderRecentSwatches() {
  recentSwatchesEl.textContent = '';
  for (const hex of state.recentColors) {
    recentSwatchesEl.append(el('button', {
      type: 'button',
      class: 'swatch',
      'data-hex': hex,
      title: `Couleur récente ${hex}`,
      'aria-label': `Couleur récente ${hex}`,
      style: `--swatch:${hex}`,
    }));
  }
}

function updateSideColorControl() {
  // Le bandeau n'existe que sur le modèle « design »
  $('#sideColorCtl').hidden = state.template !== 'design';

  renderRecentSwatches();
  let matched = false;
  for (const b of [...sideSwatchesEl.children, ...recentSwatchesEl.children]) {
    const on = b.dataset.hex === state.sideColor;
    b.classList.toggle('active', on);
    b.setAttribute('aria-pressed', String(on));
    if (on) matched = true;
  }
  // La pipette reflète et signale toute teinte hors palette
  pipetteBtnEl.style.setProperty('--swatch', state.sideColor);
  pipetteBtnEl.classList.toggle('active', !matched);
}

/* ---------- Contrôle de la couleur des titres ----------
   Menu de mode + sélecteur de couleur libre (visible seulement en mode
   « custom »). Vaut pour les deux modèles ; en « pro », les modes bandeau /
   complémentaire s'appuient sur state.sideColor (même s'il n'y a pas de
   bandeau visible). */
const titleColorModeEl = $('#titleColorMode');
const titleColorInputEl = $('#titleColorInput');

function updateTitleColorControl() {
  titleColorModeEl.value = state.titleColorMode;
  titleColorInputEl.hidden = state.titleColorMode !== 'custom';
  titleColorInputEl.value = normalizeHexColor(state.titleColor, TITLE_COLOR_DEFAULT);
}

titleColorModeEl.addEventListener('change', () => {
  state.titleColorMode = normalizeTitleMode(titleColorModeEl.value);
  applyTitleColor();
  updateTitleColorControl();
  save();
});

titleColorInputEl.addEventListener('input', () => {
  state.titleColor = normalizeHexColor(titleColorInputEl.value, TITLE_COLOR_DEFAULT);
  applyTitleColor();
  save();
});

/* ---------- Contrôle des tailles de police ----------
   Un réglage par rôle de texte, groupé par zone : le bandeau (gauche) et la
   colonne principale (droite) ont leurs propres tailles. Le modèle « pro »
   n'ayant qu'une colonne, il n'affiche que le second groupe.

   Chaque modèle garde ses réglages : passer de « pro » à « design » et revenir
   ne perd rien, et les densités très différentes des deux modèles ne se
   contaminent pas. */

const fontControlsEl = $('#fontControls');

const fontTemplate = () => (state.template === 'design' ? 'design' : 'pro');

function fontRole(zone, key) {
  return (FONT_ROLES[fontTemplate()][zone] || []).find((r) => r.key === key);
}

function renderFontControls() {
  fontControlsEl.textContent = '';
  const tpl = fontTemplate();
  for (const [zone, roles] of Object.entries(FONT_ROLES[tpl])) {
    const label = FONT_ZONE_LABELS[tpl][zone];
    const group = el('div', { class: 'fs-group' }, label ? el('h3', { text: label }) : null);
    for (const r of roles) {
      const common = {
        min: String(FONT_BOUNDS.min),
        max: String(FONT_BOUNDS.max),
        step: '0.5',
        value: String(state.fontSizes[tpl][zone][r.key]),
        'data-zone': zone,
        'data-role': r.key,
      };
      const fullLabel = `${r.label}${label ? ` — ${label}` : ''} (en pixels)`;
      // La ligne n'est PAS un <label> englobant : un <label> ne peut désigner
      // qu'un seul contrôle, et il capterait les clics destinés au curseur
      // (le clic est alors réémis vers le contrôle désigné, et le glissement
      // du curseur ne se fait plus). L'intitulé visible est donc rattaché au
      // champ chiffré par `for`, et le curseur porte son propre aria-label.
      const id = `fs-${tpl}-${zone}-${r.key}`;
      group.append(
        el(
          'div',
          { class: 'fs-row' },
          el('label', { class: 'fs-label', for: id, text: r.label }),
          el('input', {
            type: 'range', class: 'fs-field fs-slider', 'aria-label': fullLabel, ...common,
          }),
          el('input', {
            type: 'number', class: 'fs-field fs-input', id, inputmode: 'decimal', ...common,
          }),
          el('span', { class: 'fs-unit', text: 'px' })
        )
      );
    }
    fontControlsEl.append(group);
  }
}

/* ---------- Retour arrière (Cmd/Ctrl+Z) sur les tailles de texte ---------- */

// Une entrée par interaction complète (glissement du curseur du début à la
// fin, ou frappe jusqu'à la validation) — pas par évènement `input`, sinon
// Cmd+Z ne reviendrait que d'un demi-pixel à la fois. `fontSizePending`
// mémorise l'état AVANT la première frappe/le premier déplacement de
// l'interaction en cours : il faut le capturer à ce moment précis, car
// l'écouteur `input` met déjà `state.fontSizes` à jour en direct pendant
// l'interaction (comparer à l'état au moment de `change` serait trop tard,
// il aurait déjà été écrasé).
const fontSizeHistory = [];
const FONT_SIZE_HISTORY_MAX = 50;
let fontSizePending = null; // { tpl, prev } | null

function snapshotFontSize(tpl) {
  return { tpl, prev: JSON.parse(JSON.stringify(state.fontSizes[tpl])) };
}

function pushFontSizeHistory(entry) {
  fontSizeHistory.push(entry);
  if (fontSizeHistory.length > FONT_SIZE_HISTORY_MAX) fontSizeHistory.shift();
}

function undoFontSize() {
  const entry = fontSizeHistory.pop();
  if (!entry) return false;
  state.fontSizes[entry.tpl] = entry.prev;
  if (entry.tpl === fontTemplate()) {
    applyFontSizes();
    renderFontControls();
  }
  save();
  return true;
}

// N'intercepte Cmd/Ctrl+Z que s'il reste une taille de texte à annuler :
// pile vide → l'évènement suit son cours normalement (undo natif du
// navigateur pour un champ texte en cours d'édition, par exemple).
document.addEventListener('keydown', (e) => {
  if (!(e.metaKey || e.ctrlKey) || e.shiftKey || e.key.toLowerCase() !== 'z') return;
  if (undoFontSize()) e.preventDefault();
});

// Curseur et champ chiffré règlent la même taille : celui qu'on ne touche pas
// suit l'autre. Le curseur ne prend que des valeurs valides ; le champ, lui,
// peut être vide ou hors bornes en cours de frappe (voir plus bas).
function syncFontRow(source, value) {
  for (const other of source.closest('.fs-row').querySelectorAll('.fs-field')) {
    if (other !== source) other.value = String(value);
  }
}

// Pendant la frappe (ou le glissement du curseur) : on applique la taille sans
// re-rendre le CV (un re-rendu perdrait le curseur de saisie si l'utilisateur
// édite le CV en parallèle) et sans corriger le champ — la valeur saisie est
// seulement bornée dans l'état.
fontControlsEl.addEventListener('input', (e) => {
  const inp = e.target.closest('.fs-field');
  if (!inp || inp.value.trim() === '') return;
  const role = fontRole(inp.dataset.zone, inp.dataset.role);
  if (!role) return;
  const tpl = fontTemplate();
  // Capturé une seule fois, avant la première mutation de cette interaction.
  if (!fontSizePending) fontSizePending = snapshotFontSize(tpl);
  const val = window.cvClampFontSize(inp.value, role.def);
  state.fontSizes[tpl][inp.dataset.zone][role.key] = val;
  syncFontRow(inp, val);
  applyFontSizes();
  save();
});

// À la validation (sortie du champ, flèches) : le champ affiche la valeur
// réellement retenue — un champ vidé ou hors bornes revient au défaut.
fontControlsEl.addEventListener('change', (e) => {
  const inp = e.target.closest('.fs-field');
  if (!inp) return;
  const role = fontRole(inp.dataset.zone, inp.dataset.role);
  if (!role) return;
  const tpl = fontTemplate();
  const val = window.cvClampFontSize(inp.value, role.def);
  state.fontSizes[tpl][inp.dataset.zone][role.key] = val;
  inp.value = String(val);
  syncFontRow(inp, val);
  applyFontSizes();
  save();

  // Interaction terminée : si la valeur a bougé par rapport à l'état capturé
  // au début, c'est ce point de départ (pas l'état courant, déjà à jour)
  // qu'il faut empiler pour Cmd/Ctrl+Z.
  if (fontSizePending) {
    if (JSON.stringify(fontSizePending.prev) !== JSON.stringify(state.fontSizes[tpl])) {
      pushFontSizeHistory(fontSizePending);
    }
    fontSizePending = null;
  }
});

$('#fontResetBtn').addEventListener('click', () => {
  // Seul le modèle affiché est remis à zéro : l'autre garde ses réglages.
  const tpl = fontTemplate();
  pushFontSizeHistory(snapshotFontSize(tpl));
  state.fontSizes[tpl] = normalizeFontSizes(null)[tpl];
  applyFontSizes();
  renderFontControls();
  save();
});

/* ---------- Recherche dans l'état ---------- */

function findExp(id) {
  return state.experiences.find((e) => e.id === id);
}

// Retrouve l'expérience/formation/projet propriétaire d'un <section class="exp">,
// quel que soit son type — les trois partagent la même structure (titre, détail
// éventuel, liste de points).
function ownerFromSection(section) {
  if (!section) return null;
  if (section.dataset.expId) return findExp(section.dataset.expId);
  if (section.dataset.eduId) return state.education.find((x) => x.id === section.dataset.eduId);
  if (section.dataset.projectId) return state.projects.find((x) => x.id === section.dataset.projectId);
  return null;
}

// Tient l'ordre proposé d'une expérience en phase avec ses tirets : un tiret
// ajouté rejoint la proposition (après son voisin, sinon en fin), un tiret
// supprimé la quitte. Sans proposition (ou pour formation/projets), no-op.
function proposalInsert(ownerId, newId, afterId = null) {
  const ord = proposalOrderFor(ownerId);
  if (!ord) return;
  const i = afterId ? ord.indexOf(afterId) : -1;
  ord.splice(i === -1 ? ord.length : i + 1, 0, newId);
}

function proposalRemove(ownerId, bulletId) {
  const ord = proposalOrderFor(ownerId);
  if (!ord) return;
  const i = ord.indexOf(bulletId);
  if (i !== -1) ord.splice(i, 1);
}

function updateTabs() {
  const layout = $('#layout');
  layout.classList.toggle('tab-create', inCreateTab());
  layout.classList.toggle('tab-base', !inCreateTab());
  for (const [id, on] of [['#tabCreate', inCreateTab()], ['#tabBase', !inCreateTab()]]) {
    const b = $(id);
    b.classList.toggle('active', on);
    b.setAttribute('aria-selected', String(on));
  }
}

function rerender() {
  // Le CV nommé de la relecture reflète le CV affiché : il doit suivre toutes
  // les modifications, pas seulement les bascules de lignes recalibrées.
  syncRewriteVersion();
  renderCV();
  renderSuggestions();
  renderRewritePanel();
  renderVersions();
  updateTemplateToggle();
  updateSideColorControl();
  updateTitleColorControl();
  renderFontControls();
  updateTabs();
  updateCvScale();
  updateOverflowNotice();
  paginatePro();
  updatePageCount();
  save();
}

/* ============================================================
   Édition : saisie, boutons, drag & drop
   ============================================================ */

// Saisie de texte (pas de re-rendu pour ne pas perdre le curseur)
cvEl.addEventListener('input', (e) => {
  const t = e.target.closest('[contenteditable]');
  if (!t) return;
  // Les champs multilignes gardent leurs sauts de ligne : innerText les rend,
  // textContent les avalerait (les <br> n'ont pas de texte).
  const text = t.hasAttribute('data-multiline') ? t.innerText.replace(/\n$/, '') : t.textContent;

  if (t.dataset.gfield === 'interest') {
    const row = t.closest('[data-interest-id]');
    const item = row && state.interests.find((x) => x.id === row.dataset.interestId);
    if (item) item.text = text;
  } else if (t.dataset.gfield) {
    const row = t.closest('[data-group-id]');
    const group = row && state.skillGroups.find((x) => x.id === row.dataset.groupId);
    if (group) group[t.dataset.gfield] = text;
  } else if (t.dataset.bind) {
    if (t.dataset.bind === 'skills') state.skills = text;
    else state.profile[t.dataset.bind] = text;
  } else if (t.dataset.lfield) {
    const row = t.closest('[data-link-id]');
    const link = row && state.profile.links.find((x) => x.id === row.dataset.linkId);
    if (link) link[t.dataset.lfield] = text;
  } else if (t.dataset.cfield) {
    const row = t.closest('[data-contact-id]');
    const item = row && state.profile.contact.find((x) => x.id === row.dataset.contactId);
    if (item) item[t.dataset.cfield] = text;
  } else if (t.classList.contains('bullet-text')) {
    const section = t.closest('section.exp');
    // Pendant une relecture, retoucher une ligne recalibrée modifie la couche
    // (et le CV nommé qui la suit), pas le texte du CV de base.
    const entry = section && rewriteEntryForBullet(section.dataset.expId, t.dataset.bulletId);
    if (entry) {
      entry.after = text;
      scheduleRewriteSync();
    } else {
      const owner = ownerFromSection(section);
      const b = owner && owner.bullets.find((x) => x.id === t.dataset.bulletId);
      if (b) b.text = text;
    }
    scheduleSuggestions();
  } else if (t.dataset.field) {
    const owner = ownerFromSection(t.closest('section.exp'));
    if (owner) owner[t.dataset.field] = text;
    scheduleSuggestions();
  }
  // La saisie ne re-rend pas le CV (le curseur y survivrait mal) : le report
  // vers le CV nommé passe donc par son propre report différé.
  if (state.rewrite) scheduleRewriteSync();
  save();
});

// Coller en texte brut uniquement
cvEl.addEventListener('paste', (e) => {
  const t = e.target.closest('[contenteditable]');
  if (!t) return;
  e.preventDefault();
  // Un champ multiligne garde les retours à la ligne du presse-papiers.
  const raw = e.clipboardData.getData('text/plain');
  const text = t.hasAttribute('data-multiline')
    ? raw.replace(/\r\n?/g, '\n').replace(/[^\S\n]+/g, ' ')
    : raw.replace(/\s+/g, ' ');
  document.execCommand('insertText', false, text);
});

// Entrée dans un tiret = nouveau tiret ; ailleurs, pas de saut de ligne
cvEl.addEventListener('keydown', (e) => {
  if (e.key !== 'Enter') return;
  const t = e.target.closest('[contenteditable]');
  if (!t) return;
  e.preventDefault();
  if (t.hasAttribute('data-multiline')) {
    // Champ multiligne : Entrée ajoute une ligne dans le champ lui-même.
    document.execCommand('insertLineBreak');
    t.dispatchEvent(new Event('input', { bubbles: true }));
  } else if (t.classList.contains('bullet-text')) {
    const section = t.closest('section.exp');
    const owner = ownerFromSection(section);
    if (!owner) return;
    const idx = owner.bullets.findIndex((b) => b.id === t.dataset.bulletId);
    const nb = { id: uid(), text: '' };
    // idx === -1 : ligne ajoutée par la relecture, sans place dans le CV de
    // base — le nouveau tiret rejoint la fin de l'expérience.
    owner.bullets.splice(idx === -1 ? owner.bullets.length : idx + 1, 0, nb);
    proposalInsert(section.dataset.expId, nb.id, idx === -1 ? null : t.dataset.bulletId);
    pendingFocusBulletId = nb.id;
    rerender();
  } else {
    t.blur();
  }
});

// Boutons (ajout / suppression / déplacement / photo / liens)
cvEl.addEventListener('click', async (e) => {
  const btn = e.target.closest('button[data-action]');
  if (!btn) return;
  const action = btn.dataset.action;

  const expSection = btn.closest('section.exp');
  const exp = expSection ? findExp(expSection.dataset.expId) : null;
  const owner = expSection ? ownerFromSection(expSection) : null;
  const li = btn.closest('li.bullet');

  const move = (arr, from, to) => {
    if (to < 0 || to >= arr.length) return;
    arr.splice(to, 0, arr.splice(from, 1)[0]);
  };

  switch (action) {
    case 'bullet-add': {
      if (!owner) return;
      const nb = { id: uid(), text: '' };
      owner.bullets.push(nb);
      proposalInsert(expSection.dataset.expId, nb.id);
      pendingFocusBulletId = nb.id;
      break;
    }
    case 'bullet-del': {
      if (!owner || !li) return;
      owner.bullets = owner.bullets.filter((b) => b.id !== li.dataset.bulletId);
      proposalRemove(expSection.dataset.expId, li.dataset.bulletId);
      // Ligne ajoutée par la relecture : elle n'existe que dans la couche.
      rewriteRemoveBullet(expSection.dataset.expId, li.dataset.bulletId);
      syncRewriteVersion();
      break;
    }
    case 'bullet-up':
    case 'bullet-down': {
      if (!owner || !li) return;
      // Dans l'onglet « Nouveau CV » pendant une proposition, les flèches
      // réordonnent la proposition ; sinon, le CV de base.
      const ord = inCreateTab() ? proposalOrderFor(expSection.dataset.expId) : null;
      const arr = ord || owner.bullets;
      const idx = ord ? ord.indexOf(li.dataset.bulletId) : owner.bullets.findIndex((b) => b.id === li.dataset.bulletId);
      // Introuvable (ligne ajoutée par la relecture) : ne rien déplacer.
      if (idx === -1) return;
      move(arr, idx, action === 'bullet-up' ? idx - 1 : idx + 1);
      break;
    }
    case 'exp-add': {
      state.experiences.push({
        id: uid(),
        role: 'Poste',
        company: 'Entreprise, Ville',
        period: 'Année – Année',
        companyDescription:
          'Lorem ipsum dolor sit amet, consectetur adipiscing elit, sed do eiusmod tempor incididunt.',
        bullets: [{ id: uid(), text: 'Décrivez une réalisation…' }],
      });
      break;
    }
    case 'exp-del': {
      if (!exp) return;
      if (!(await customConfirm('Supprimer cette expérience et tous ses tirets ?', { confirmLabel: 'Supprimer', danger: true }))) return;
      state.experiences = state.experiences.filter((x) => x.id !== exp.id);
      if (state.proposal) delete state.proposal.orders[exp.id];
      if (state.rewrite) {
        delete state.rewrite.entries[exp.id];
        dropEmptyRewrite();
        syncRewriteVersion();
      }
      break;
    }
    case 'exp-up':
    case 'exp-down': {
      if (!exp) return;
      const idx = state.experiences.indexOf(exp);
      move(state.experiences, idx, action === 'exp-up' ? idx - 1 : idx + 1);
      break;
    }
    case 'edu-add': {
      state.education.push({ id: uid(), title: 'Diplôme', detail: 'Établissement (année)', bullets: [] });
      break;
    }
    case 'edu-del': {
      if (!expSection) return;
      if (!(await customConfirm('Supprimer cette formation et tous ses points ?', { confirmLabel: 'Supprimer', danger: true }))) return;
      state.education = state.education.filter((x) => x.id !== expSection.dataset.eduId);
      break;
    }
    case 'project-add': {
      state.projects.push({ id: uid(), title: 'Projet', detail: 'technologies, résultat (année)', bullets: [] });
      break;
    }
    case 'project-del': {
      if (!expSection) return;
      if (!(await customConfirm('Supprimer ce projet et tous ses points ?', { confirmLabel: 'Supprimer', danger: true }))) return;
      state.projects = state.projects.filter((x) => x.id !== expSection.dataset.projectId);
      break;
    }
    case 'link-add': {
      state.profile.links.push({ id: uid(), label: 'Nouveau lien', url: '' });
      break;
    }
    // L'URL cible ne s'affiche pas sur le CV : elle se saisit dans la pop-up.
    // Vide ou annulé, le texte reste mais cesse d'être cliquable.
    case 'link-url': {
      const row = btn.closest('[data-link-id]');
      const link = row && state.profile.links.find((x) => x.id === row.dataset.linkId);
      if (!link) return;
      openLinkModal(link);
      return;
    }
    case 'link-del': {
      const row = btn.closest('[data-link-id]');
      state.profile.links = state.profile.links.filter((x) => x.id !== row.dataset.linkId);
      break;
    }
    case 'group-add': {
      state.skillGroups.push({ id: uid(), label: 'Intitulé', text: 'Détail' });
      break;
    }
    case 'group-del': {
      const row = btn.closest('[data-group-id]');
      state.skillGroups = state.skillGroups.filter((x) => x.id !== row.dataset.groupId);
      break;
    }
    case 'interest-add': {
      state.interests.push({ id: uid(), text: 'Centre d’intérêt' });
      break;
    }
    case 'interest-del': {
      const row = btn.closest('[data-interest-id]');
      state.interests = state.interests.filter((x) => x.id !== row.dataset.interestId);
      break;
    }
    case 'contact-add': {
      state.profile.contact.push({ id: uid(), label: 'Champ', value: '' });
      break;
    }
    case 'contact-del': {
      const row = btn.closest('[data-contact-id]');
      state.profile.contact = state.profile.contact.filter((x) => x.id !== row.dataset.contactId);
      break;
    }
    case 'photo-set': {
      openPhotoModal();
      return;
    }
    case 'photo-del': {
      state.profile.photo = '';
      state.profile.photoSrc = '';
      state.profile.photoCrop = null;
      break;
    }
    default:
      return;
  }
  rerender();
});

/* ---------- Photo : pop-up de recadrage / centrage ---------- */

const photoModalEl = $('#photoModal');
const photoCropEl = $('#photoCrop');
const photoCropImgEl = $('#photoCropImg');
const photoCropEmptyEl = $('#photoCropEmpty');
const photoZoomRowEl = $('#photoZoomRow');
const photoZoomEl = $('#photoZoom');
const photoLoadBtnEl = $('#photoLoadBtn');
const photoCancelBtnEl = $('#photoCancelBtn');
const photoApplyBtnEl = $('#photoApplyBtn');

const CROP_FRAME = 260; // taille (px) du cadre de recadrage à l'écran
const PHOTO_OUT = 300; // taille (px) de la photo finale (carré)
const MAX_ZOOM = 4; // zoom maximal, en multiple du cadrage « couverture »
const SRC_MAX = 900; // dimension max de l'original conservé (recadrage ultérieur)

// État courant de l'éditeur : image source + transformation (échelle, position).
// L'image est placée dans le cadre à `s` × sa taille naturelle, coin haut-gauche
// aux coordonnées (ox, oy) exprimées en pixels du cadre.
const cropUI = { img: null, nw: 0, nh: 0, minS: 1, s: 1, ox: 0, oy: 0 };

// Garde l'image toujours couvrante : elle ne peut pas laisser de vide au bord.
function clampCropOffset() {
  const w = cropUI.nw * cropUI.s;
  const h = cropUI.nh * cropUI.s;
  cropUI.ox = Math.min(0, Math.max(CROP_FRAME - w, cropUI.ox));
  cropUI.oy = Math.min(0, Math.max(CROP_FRAME - h, cropUI.oy));
}

function applyCropTransform() {
  clampCropOffset();
  photoCropImgEl.style.width = cropUI.nw * cropUI.s + 'px';
  photoCropImgEl.style.height = cropUI.nh * cropUI.s + 'px';
  photoCropImgEl.style.left = cropUI.ox + 'px';
  photoCropImgEl.style.top = cropUI.oy + 'px';
}

// Installe une image dans l'éditeur, en restaurant un recadrage sauvegardé si
// possible, sinon en la centrant au cadrage « couverture ».
function setCropImage(img, crop) {
  cropUI.img = img;
  cropUI.nw = img.naturalWidth;
  cropUI.nh = img.naturalHeight;
  cropUI.minS = CROP_FRAME / Math.min(cropUI.nw, cropUI.nh);
  if (crop && crop.s >= cropUI.minS) {
    cropUI.s = crop.s;
    cropUI.ox = crop.ox;
    cropUI.oy = crop.oy;
  } else {
    cropUI.s = cropUI.minS;
    cropUI.ox = (CROP_FRAME - cropUI.nw * cropUI.s) / 2;
    cropUI.oy = (CROP_FRAME - cropUI.nh * cropUI.s) / 2;
  }
  photoCropImgEl.src = img.src;
  photoCropImgEl.hidden = false;
  photoCropEmptyEl.hidden = true;
  photoZoomRowEl.hidden = false;
  photoApplyBtnEl.disabled = false;
  photoZoomEl.value = String(Math.min(MAX_ZOOM, Math.max(1, cropUI.s / cropUI.minS)));
  applyCropTransform();
}

// Réduit l'image (max SRC_MAX px) et renvoie un data URL conservable, servant
// à la fois d'aperçu dans l'éditeur et d'original pour un recadrage ultérieur.
function downscaledSource(img) {
  const scale = Math.min(1, SRC_MAX / Math.max(img.naturalWidth, img.naturalHeight));
  const w = Math.max(1, Math.round(img.naturalWidth * scale));
  const h = Math.max(1, Math.round(img.naturalHeight * scale));
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  canvas.getContext('2d').drawImage(img, 0, 0, w, h);
  return canvas.toDataURL('image/jpeg', 0.9);
}

function openPhotoModal() {
  photoModalEl.hidden = false;
  cropUI.img = null;
  photoCropImgEl.hidden = true;
  photoCropImgEl.removeAttribute('src');
  photoCropEmptyEl.hidden = false;
  photoZoomRowEl.hidden = true;
  photoApplyBtnEl.disabled = true;
  // Précharge la photo existante pour permettre un simple recentrage : on
  // reprend l'original conservé (recadrage restaurable) ou, à défaut d'original
  // (CV anciens), la photo déjà recadrée.
  const src = state.profile.photoSrc || state.profile.photo;
  if (src) {
    const img = new Image();
    img.onload = () => {
      if (!photoModalEl.hidden) setCropImage(img, state.profile.photoSrc ? state.profile.photoCrop : null);
    };
    img.src = src;
  }
}

function closePhotoModal() {
  photoModalEl.hidden = true;
  cropUI.img = null;
}

// Lit un fichier image (sélecteur ou glisser-déposer), le réduit, puis le
// charge dans l'éditeur au cadrage « couverture » centré.
function loadPhotoFile(file) {
  if (!file || !file.type.startsWith('image/')) {
    alert('Veuillez déposer un fichier image.');
    return;
  }
  const url = URL.createObjectURL(file);
  const img = new Image();
  img.onload = () => {
    URL.revokeObjectURL(url);
    const reduced = new Image();
    reduced.onload = () => setCropImage(reduced, null);
    reduced.src = downscaledSource(img);
  };
  img.onerror = () => {
    URL.revokeObjectURL(url);
    alert('Impossible de lire cette image.');
  };
  img.src = url;
}

// Charger / remplacer l'image : ouvre le sélecteur de fichier natif.
photoLoadBtnEl.addEventListener('click', () => photoFileEl.click());

photoFileEl.addEventListener('change', (e) => {
  const file = e.target.files[0];
  e.target.value = '';
  loadPhotoFile(file);
});

// Glisser-déposer d'une image directement dans le cadre.
['dragenter', 'dragover'].forEach((type) => {
  photoCropEl.addEventListener(type, (e) => {
    e.preventDefault();
    photoCropEl.classList.add('drop-over');
  });
});
['dragleave', 'dragend'].forEach((type) => {
  photoCropEl.addEventListener(type, () => photoCropEl.classList.remove('drop-over'));
});
photoCropEl.addEventListener('drop', (e) => {
  e.preventDefault();
  photoCropEl.classList.remove('drop-over');
  loadPhotoFile(e.dataTransfer.files && e.dataTransfer.files[0]);
});

// Zoom : l'échelle de la barre est un multiple du cadrage « couverture » ; le
// point image situé au centre du cadre reste fixe pendant le zoom.
photoZoomEl.addEventListener('input', () => {
  if (!cropUI.img) return;
  const newS = cropUI.minS * parseFloat(photoZoomEl.value);
  const cx = (CROP_FRAME / 2 - cropUI.ox) / cropUI.s;
  const cy = (CROP_FRAME / 2 - cropUI.oy) / cropUI.s;
  cropUI.s = newS;
  cropUI.ox = CROP_FRAME / 2 - cx * newS;
  cropUI.oy = CROP_FRAME / 2 - cy * newS;
  applyCropTransform();
});

// Glisser pour recentrer l'image dans le cadre.
let cropDrag = null;
photoCropEl.addEventListener('pointerdown', (e) => {
  if (!cropUI.img) return;
  cropDrag = { x: e.clientX, y: e.clientY, ox: cropUI.ox, oy: cropUI.oy };
  photoCropEl.setPointerCapture(e.pointerId);
  photoCropEl.classList.add('dragging');
});
photoCropEl.addEventListener('pointermove', (e) => {
  if (!cropDrag) return;
  cropUI.ox = cropDrag.ox + (e.clientX - cropDrag.x);
  cropUI.oy = cropDrag.oy + (e.clientY - cropDrag.y);
  applyCropTransform();
});
function endCropDrag() {
  if (!cropDrag) return;
  cropDrag = null;
  photoCropEl.classList.remove('dragging');
}
photoCropEl.addEventListener('pointerup', endCropDrag);
photoCropEl.addEventListener('pointercancel', endCropDrag);

// Valider : rend la portion visible du cadre en un carré PHOTO_OUT × PHOTO_OUT.
photoApplyBtnEl.addEventListener('click', () => {
  if (!cropUI.img) {
    closePhotoModal();
    return;
  }
  clampCropOffset();
  const sx = -cropUI.ox / cropUI.s;
  const sy = -cropUI.oy / cropUI.s;
  const sSize = CROP_FRAME / cropUI.s;
  const canvas = document.createElement('canvas');
  canvas.width = PHOTO_OUT;
  canvas.height = PHOTO_OUT;
  canvas.getContext('2d').drawImage(cropUI.img, sx, sy, sSize, sSize, 0, 0, PHOTO_OUT, PHOTO_OUT);
  state.profile.photo = canvas.toDataURL('image/jpeg', 0.85);
  state.profile.photoSrc = cropUI.img.src;
  state.profile.photoCrop = { s: cropUI.s, ox: cropUI.ox, oy: cropUI.oy };
  closePhotoModal();
  rerender();
});

photoCancelBtnEl.addEventListener('click', closePhotoModal);
// Fermeture par clic sur le fond ou par Échap.
photoModalEl.addEventListener('mousedown', (e) => {
  if (e.target === photoModalEl) closePhotoModal();
});

/* ---------- Lien : pop-up d'adresse (URL cible) ---------- */

const linkModalEl = $('#linkModal');
const linkUrlInputEl = $('#linkUrlInput');
const linkFieldLabelEl = $('#linkFieldLabel');
const linkCancelBtnEl = $('#linkCancelBtn');
const linkApplyBtnEl = $('#linkApplyBtn');

// Lien en cours d'édition (référence directe dans state.profile.links).
let editingLink = null;

function openLinkModal(link) {
  editingLink = link;
  linkFieldLabelEl.textContent = link.label ? `Adresse pour « ${link.label} »` : 'Adresse';
  linkUrlInputEl.value = link.url || '';
  linkModalEl.hidden = false;
  linkUrlInputEl.focus();
  linkUrlInputEl.select();
}

function closeLinkModal() {
  linkModalEl.hidden = true;
  editingLink = null;
}

function applyLinkModal() {
  if (editingLink) {
    editingLink.url = linkUrlInputEl.value.trim();
    closeLinkModal();
    rerender();
  } else {
    closeLinkModal();
  }
}

linkApplyBtnEl.addEventListener('click', applyLinkModal);
linkCancelBtnEl.addEventListener('click', closeLinkModal);
// Entrée valide, Échap annule ; clic sur le fond annule aussi.
linkUrlInputEl.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') {
    e.preventDefault();
    applyLinkModal();
  }
});
linkModalEl.addEventListener('mousedown', (e) => {
  if (e.target === linkModalEl) closeLinkModal();
});

/* ---------- Confirmation générique (remplace window.confirm) ----------
   Même pop-up réutilisée à chaque appel : message et libellé du bouton de
   validation sont posés à l'ouverture. Une seule confirmation à la fois. */

const confirmModalEl = $('#confirmModal');
const confirmModalMessageEl = $('#confirmModalMessage');
const confirmCancelBtnEl = $('#confirmCancelBtn');
const confirmOkBtnEl = $('#confirmOkBtn');

// Résolveur de la confirmation actuellement affichée, le cas échéant.
let resolveConfirm = null;

function closeConfirmModal(result) {
  confirmModalEl.hidden = true;
  const resolve = resolveConfirm;
  resolveConfirm = null;
  if (resolve) resolve(result);
}

// `danger` : bouton de validation en rouge plein, pour les actions destructrices
// (suppression) plutôt que les simples remplacements (sauvegarder, charger).
function customConfirm(message, { confirmLabel = 'Confirmer', danger = false } = {}) {
  return new Promise((resolve) => {
    resolveConfirm = resolve;
    confirmModalMessageEl.textContent = message;
    confirmOkBtnEl.textContent = confirmLabel;
    confirmOkBtnEl.classList.toggle('danger', danger);
    confirmModalEl.hidden = false;
    confirmOkBtnEl.focus();
  });
}

confirmOkBtnEl.addEventListener('click', () => closeConfirmModal(true));
confirmCancelBtnEl.addEventListener('click', () => closeConfirmModal(false));
confirmModalEl.addEventListener('mousedown', (e) => {
  if (e.target === confirmModalEl) closeConfirmModal(false);
});

// Échap ferme la pop-up ouverte (photo, lien ou confirmation).
document.addEventListener('keydown', (e) => {
  if (e.key !== 'Escape') return;
  if (!photoModalEl.hidden) closePhotoModal();
  else if (!linkModalEl.hidden) closeLinkModal();
  else if (!confirmModalEl.hidden) closeConfirmModal(false);
});

/* ---------- Drag & drop des tirets ---------- */

let dragEl = null;

cvEl.addEventListener('mousedown', (e) => {
  const handle = e.target.closest('.drag-handle');
  if (handle) handle.closest('li.bullet').draggable = true;
});

cvEl.addEventListener('dragstart', (e) => {
  const li = e.target.closest('li.bullet');
  if (!li || !li.draggable) {
    e.preventDefault();
    return;
  }
  dragEl = li;
  li.classList.add('dragging');
  e.dataTransfer.effectAllowed = 'move';
  try {
    e.dataTransfer.setData('text/plain', '');
  } catch {
    /* IE/anciens navigateurs */
  }
});

cvEl.addEventListener('dragover', (e) => {
  if (!dragEl) return;
  const list = dragEl.parentElement;
  const over = e.target.closest('li.bullet');
  if (over && over !== dragEl && over.parentElement === list) {
    e.preventDefault();
    const r = over.getBoundingClientRect();
    const before = e.clientY < r.top + r.height / 2;
    list.insertBefore(dragEl, before ? over : over.nextSibling);
  } else if (e.target.closest('ul.bullets') === list) {
    e.preventDefault();
  }
});

cvEl.addEventListener('dragend', () => {
  if (!dragEl) return;
  dragEl.classList.remove('dragging');
  dragEl.draggable = false;
  const ul = dragEl.closest('ul.bullets');
  const section = dragEl.closest('section.exp');
  const owner = ownerFromSection(section);
  dragEl = null;
  if (owner) {
    const known = new Set(owner.bullets.map((b) => b.id));
    const order = [...ul.querySelectorAll('li.bullet')]
      .map((li) => li.dataset.bulletId)
      .filter((id) => known.has(id));
    // Pendant une proposition (onglet « Nouveau CV »), le glisser-déposer
    // réordonne la proposition ; sinon, le CV de base.
    const ord = inCreateTab() ? proposalOrderFor(section.dataset.expId) : null;
    if (ord) ord.splice(0, ord.length, ...order);
    else owner.bullets.sort((a, b) => order.indexOf(a.id) - order.indexOf(b.id));
  }
  rerender();
});

/* ============================================================
   Versions nommées du CV
   ============================================================ */

function snapshotCV() {
  return JSON.parse(
    JSON.stringify({
      profile: state.profile,
      template: state.template,
      sideColor: state.sideColor,
      titleColorMode: state.titleColorMode,
      titleColor: state.titleColor,
      fontSizes: state.fontSizes,
      experiences: state.experiences,
      education: state.education,
      projects: state.projects,
      skills: state.skills,
      skillGroups: state.skillGroups,
      interests: state.interests,
      jobText: state.jobText,
    })
  );
}

// Le CV actuel est-il déjà identique à l'une des sauvegardes ? Sert à ne pas
// demander de confirmation avant de charger une autre version quand il n'y a
// justement rien à perdre.
function isCurrentCvSaved() {
  const current = JSON.stringify(snapshotCV());
  return state.versions.some((v) => JSON.stringify(v.data) === current);
}

// Le CV affiché diffère-t-il de la version actuellement chargée ? Sert à
// signaler à l'utilisateur qu'il a des modifications non enregistrées sur
// cette version.
function isActiveVersionDirty() {
  if (!state.activeVersionId) return false;
  const active = state.versions.find((v) => v.id === state.activeVersionId);
  if (!active) return false;
  return JSON.stringify(active.data) !== JSON.stringify(snapshotCV());
}

// Rafraîchit l'indicateur « non enregistré » sur la ligne de la version
// active, sans re-rendre toute la liste (préserve le curseur pendant la
// saisie). Le rendu visuel/texte détaillé est posé ailleurs ; ici on ne fait
// que basculer une classe d'état.
function updateSaveIndicator() {
  const item = versionListEl && versionListEl.querySelector('.version-item.active');
  if (!item) return;
  const dirty = isActiveVersionDirty();
  item.classList.toggle('dirty', dirty);
  const btn = item.querySelector('.version-save');
  if (btn) {
    btn.classList.toggle('dirty', dirty);
    const icon = btn.querySelector('.version-save-icon');
    if (icon) icon.textContent = dirty ? '●' : '✓';
    btn.title = dirty
      ? 'Modifications non enregistrées — cliquez pour les enregistrer dans cette version'
      : 'Cette version est à jour';
  }
}

function applyCV(data) {
  const cv = normalizeCV(JSON.parse(JSON.stringify(data)));
  state.profile = cv.profile;
  state.template = cv.template;
  state.sideColor = cv.sideColor;
  state.titleColorMode = cv.titleColorMode;
  state.titleColor = cv.titleColor;
  state.fontSizes = cv.fontSizes;
  state.experiences = cv.experiences;
  state.education = cv.education;
  state.projects = cv.projects;
  state.skills = cv.skills;
  state.skillGroups = cv.skillGroups;
  state.interests = cv.interests;
  state.jobText = cv.jobText;
  jobTextEl.value = state.jobText;
}

// Nombre de CV sauvegardés affichés en permanence en haut de la liste ; les
// suivants sont repliés dans un menu déroulant pour ne pas surcharger le
// panneau quand il y en a beaucoup.
const VERSIONS_ALWAYS_VISIBLE = 2;

function buildVersionItem(v) {
  const date = new Date(v.createdAt).toLocaleDateString('fr-FR', { day: 'numeric', month: 'short', year: 'numeric' });
  const isActive = v.id === state.activeVersionId;
  const dirty = isActive && isActiveVersionDirty();
  const saveBtn = el('button', {
    type: 'button',
    class: 'ghost version-save' + (isActive ? ' has-state' : '') + (dirty ? ' dirty' : ''),
    'data-vaction': 'overwrite',
    title: isActive
      ? (dirty
          ? 'Modifications non enregistrées — cliquez pour les enregistrer dans cette version'
          : 'Cette version est à jour')
      : 'Enregistrer le CV actuel dans cette sauvegarde',
  },
    isActive ? el('span', { class: 'version-save-icon', 'aria-hidden': 'true', text: dirty ? '●' : '✓' }) : null,
    el('span', { class: 'version-save-label', text: 'Sauvegarder' })
  );
  return el(
    'li',
    { class: 'version-item' + (isActive ? ' active' : ''), 'data-version-id': v.id },
    el(
      'div',
      { class: 'version-head' },
      el('div', { class: 'version-name', contenteditable: 'true', title: 'Cliquez pour renommer' }, v.name),
      saveBtn
    ),
    el('div', {
      class: 'version-meta',
      text: `${date} · modèle ${v.data.template === 'design' ? 'design' : 'pro'}` +
        (isActive ? ' · chargée' : ''),
    }),
    el(
      'div',
      { class: 'version-actions' },
      el('button', { type: 'button', 'data-vaction': 'load', text: 'Charger' }),
      el('button', { type: 'button', class: 'ghost danger', 'data-vaction': 'delete', text: 'Supprimer' })
    )
  );
}

function renderVersions() {
  versionListEl.textContent = '';
  if (state.versions.length === 0) {
    versionListEl.append(el('li', { class: 'empty-note', text: 'Aucune version sauvegardée pour le moment.' }));
    return;
  }
  const visible = state.versions.slice(0, VERSIONS_ALWAYS_VISIBLE);
  const rest = state.versions.slice(VERSIONS_ALWAYS_VISIBLE);
  for (const v of visible) versionListEl.append(buildVersionItem(v));
  if (rest.length > 0) {
    // Repliés par défaut, sauf si la version active s'y trouve : on ne veut
    // pas cacher le CV en cours d'édition dans un menu fermé.
    const hasActiveInRest = rest.some((v) => v.id === state.activeVersionId);
    const details = el(
      'details',
      { class: 'version-more', open: hasActiveInRest ? '' : undefined },
      el('summary', { text: `Autres CV sauvegardés (${rest.length})` }),
      el('ul', { class: 'version-more-list' }, ...rest.map(buildVersionItem))
    );
    versionListEl.append(el('li', { class: 'version-more-item' }, details));
  }
}

$('#saveVersionBtn').addEventListener('click', () => {
  const name = versionNameEl.value.trim() ||
    `Version du ${new Date().toLocaleDateString('fr-FR')} à ${new Date().toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })}`;
  const v = { id: uid(), name, createdAt: Date.now(), data: snapshotCV() };
  state.versions.unshift(v);
  state.activeVersionId = v.id;
  versionNameEl.value = '';
  save();
  renderVersions();
});

versionNameEl.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') $('#saveVersionBtn').click();
});

// Renommage direct dans la liste
versionListEl.addEventListener('input', (e) => {
  const nameEl = e.target.closest('.version-name');
  if (!nameEl) return;
  const v = state.versions.find((x) => x.id === nameEl.closest('.version-item').dataset.versionId);
  if (v) {
    v.name = nameEl.textContent;
    save();
  }
});

versionListEl.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && e.target.closest('.version-name')) {
    e.preventDefault();
    e.target.blur();
  }
});

versionListEl.addEventListener('click', async (e) => {
  const btn = e.target.closest('button[data-vaction]');
  if (!btn) return;
  const id = btn.closest('.version-item').dataset.versionId;
  const v = state.versions.find((x) => x.id === id);
  if (!v) return;

  switch (btn.dataset.vaction) {
    case 'load': {
      // Rien à perdre si le CV affiché est déjà sauvegardé quelque part :
      // pas besoin de confirmation dans ce cas.
      if (!isCurrentCvSaved() && !(await customConfirm(
        `Charger « ${v.name} » comme CV de base ? Le CV de base actuel sera remplacé (sauvegardez-le d'abord si besoin).`,
        { confirmLabel: 'Charger' }
      ))) return;
      applyCV(v.data);
      // Proposition et relecture référençaient l'ancien CV : plus de sens.
      state.proposal = null;
      state.rewrite = null;
      state.activeVersionId = v.id;
      rerender();
      break;
    }
    case 'overwrite': {
      if (!(await customConfirm(
        `Remplacer le contenu de la version « ${v.name} » par le CV actuel ?`,
        { confirmLabel: 'Sauvegarder' }
      ))) return;
      v.data = snapshotCV();
      v.createdAt = Date.now();
      state.activeVersionId = v.id;
      save();
      renderVersions();
      break;
    }
    case 'delete': {
      if (!(await customConfirm(`Supprimer la version « ${v.name} » ?`, { confirmLabel: 'Supprimer', danger: true }))) return;
      state.versions = state.versions.filter((x) => x.id !== id);
      if (state.activeVersionId === id) state.activeVersionId = null;
      save();
      renderVersions();
      break;
    }
  }
});

/* ============================================================
   Analyse de l'offre d'emploi
   ============================================================ */

// Mots vides (français + anglais), déjà sans accents
const STOPWORDS = new Set(
  ('le la les un une des du de d l et a au aux en dans pour par sur avec sans sous ou car mais donc or ni ' +
    'vous nous je tu il elle ils elles on ce cet cette ces se sa son ses leur leurs votre vos notre nos mon ma mes ton ta tes ' +
    'qui que quoi dont ou est sont etre avoir ete etant fait faire faites plus moins tres bien tout tous toute toutes ' +
    'autre autres comme aussi afin ainsi alors chez entre vers deja encore apres avant pendant depuis lors selon ' +
    'meme peut peuvent pouvez devra devrez sera serez seront avez avons ont nous vous etes suis notamment idealement ' +
    'poste mission missions profil recherche recherchons recherchee recherchez candidat candidate candidature offre emploi ' +
    'entreprise societe equipe equipes annee annees ans mois experience experiences niveau bac cdi cdd stage temps plein ' +
    'the a an and or of to in for with on at by is are was were be been being as this that these those you we they it ' +
    'your our their will would can could should must have has had do does not from about into over under more most other ' +
    'job work team years year skills skill required requirements experience company role position candidate apply'
  ).split(/\s+/)
);

// Mots courts (2 caractères) à conserver malgré tout
const SHORT_KEEP = new Set(['go', 'ci', 'cd', 'ux', 'ui', 'bi', 'ia', 'ai', 'qa', 'vr', 'ar', 'js', 'ts', 'c#', 'r&d', 'c++', 'seo', 'sea']);

function normalizeText(text) {
  return text.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
}

function tokenize(text) {
  const raw = normalizeText(text).match(/[a-z0-9][a-z0-9+#&]*/g) || [];
  return raw.filter((w) => {
    if (STOPWORDS.has(w)) return false;
    if (/^\d+$/.test(w)) return false;
    if (w.length < 3) return SHORT_KEEP.has(w);
    return true;
  });
}

// Modèle de l'offre : fréquences des mots-clés et des paires de mots consécutifs
function buildJobModel(text) {
  const tokens = tokenize(text);
  const freq = new Map();
  const bigrams = new Map();
  for (let i = 0; i < tokens.length; i++) {
    freq.set(tokens[i], (freq.get(tokens[i]) || 0) + 1);
    if (i > 0) {
      const bg = tokens[i - 1] + ' ' + tokens[i];
      bigrams.set(bg, (bigrams.get(bg) || 0) + 1);
    }
  }
  return { freq, bigrams, empty: tokens.length === 0 };
}

function scoreBullet(text, model) {
  const tokens = tokenize(text);
  const seen = new Set();
  const bigramSeen = new Set();
  let score = 0;
  const matched = [];

  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i];
    if (model.freq.has(t) && !seen.has(t)) {
      seen.add(t);
      score += 1 + Math.log(model.freq.get(t));
      matched.push(t);
    }
    if (i > 0) {
      const bg = tokens[i - 1] + ' ' + tokens[i];
      if (model.bigrams.has(bg) && !bigramSeen.has(bg)) {
        bigramSeen.add(bg);
        score += 1.5 * (1 + Math.log(model.bigrams.get(bg)));
      }
    }
  }
  return { score, matched };
}

function topKeywords(model, n) {
  return [...model.freq.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, n)
    .map(([w]) => w);
}

function suggestOrder(exp, model) {
  const scored = exp.bullets.map((b, idx) => ({ bullet: b, currentIndex: idx, ...scoreBullet(b.text, model) }));
  // Tri stable : à score égal, l'ordre actuel est conservé
  const suggested = [...scored].sort((a, b) => b.score - a.score);
  const alreadyApplied = suggested.every((s, i) => s.bullet.id === exp.bullets[i].id);
  return { scored: suggested, alreadyApplied };
}

let suggestionTimer = null;
function scheduleSuggestions() {
  clearTimeout(suggestionTimer);
  suggestionTimer = setTimeout(renderSuggestions, 400);
}

/* ---------- Proposition de nouveau CV ---------- */

// Texte effectivement analysé : la saisie collée dans le panneau « Offre ».
function effectiveJobText() {
  return (state.jobText || '').trim();
}

// Détails d'affichage de la proposition, remis à zéro à chaque nouvelle
// analyse : nom saisi pour le futur CV et confirmation d'enregistrement.
let newCvNameDraft = '';
let proposalSaved = false;

// Construit la proposition : l'ordre suggéré par l'analyse, par expérience.
// Le CV de base n'est PAS modifié — la proposition n'est qu'une surcouche
// d'ordre, affichée dans l'onglet « Nouveau CV ».
function buildProposal() {
  newCvNameDraft = '';
  proposalSaved = false;
  const model = buildJobModel(effectiveJobText());
  if (model.empty) {
    state.proposal = null;
    return;
  }
  const orders = {};
  let changed = false;
  for (const exp of state.experiences) {
    const suggested = suggestOrder(exp, model).scored.map((s) => s.bullet.id);
    orders[exp.id] = suggested;
    if (suggested.some((id, i) => exp.bullets[i].id !== id)) changed = true;
  }
  state.proposal = changed ? { orders } : null;
}

// Nom proposé pour le CV enregistré : la date de l'analyse.
function defaultVersionName() {
  return `Offre du ${new Date().toLocaleDateString('fr-FR')}`;
}

// Le CV de base, avec les tirets de chaque expérience dans l'ordre proposé :
// c'est ce qui est enregistré comme nouveau CV.
function snapshotProposalCV() {
  const snap = snapshotCV();
  for (const exp of snap.experiences) {
    const ord = proposalOrderFor(exp.id);
    if (!ord) continue;
    const byId = new Map(exp.bullets.map((b) => [b.id, b]));
    const out = [];
    for (const id of ord) {
      const b = byId.get(id);
      if (b) {
        out.push(b);
        byId.delete(id);
      }
    }
    exp.bullets = [...out, ...byId.values()];
  }
  return snap;
}

function saveProposalVersion() {
  const input = $('#newCvName');
  const name = (input && input.value.trim()) || defaultVersionName();
  const v = { id: uid(), name, createdAt: Date.now(), data: snapshotProposalCV() };
  state.versions.unshift(v);
  state.activeVersionId = v.id;
  proposalSaved = true;
  rerender();
}

function renderSuggestions() {
  resultsEl.textContent = '';
  const jobText = effectiveJobText();
  if (!jobText) {
    resultsEl.append(el('p', { class: 'empty-note', text: 'Aucune offre analysée pour le moment.' }));
    return;
  }

  const model = buildJobModel(jobText);
  if (model.empty) {
    resultsEl.append(el('p', { class: 'empty-note', text: 'Aucun mot-clé exploitable trouvé dans ce texte.' }));
    return;
  }

  // Mots-clés principaux de l'offre
  const kwBox = el('div', { class: 'keywords-box' }, el('div', { class: 'label', text: 'Mots-clés principaux de l’offre' }));
  topKeywords(model, 12).forEach((w) => kwBox.append(el('span', { class: 'chip', text: w })));
  resultsEl.append(kwBox);

  if (state.proposal) {
    const box = el(
      'div',
      { class: 'proposal-box' },
      el('h3', { text: 'Nouveau CV proposé' }),
      el('p', {
        class: 'hint',
        text: 'Le CV ci-dessous est réordonné pour cette offre — le CV de base n’est pas modifié. ' +
          'Survolez le CV pour voir les tirets déplacés (badge « était n°X »), ' +
          'puis enregistrez ce nouveau CV pour le retrouver dans l’onglet « CV de base ».',
      })
    );
    for (const exp of state.experiences) {
      if (!proposalOrderFor(exp.id)) continue;
      let moved = 0;
      displayBullets(exp).forEach((b, i) => {
        if (!exp.bullets[i] || exp.bullets[i].id !== b.id) moved += 1;
      });
      box.append(
        el(
          'div',
          { class: 'proposal-exp-line' },
          el('strong', { text: exp.role || 'Expérience' }),
          ` : ${moved ? `${moved} tiret${moved > 1 ? 's' : ''} déplacé${moved > 1 ? 's' : ''}` : 'ordre inchangé'}`
        )
      );
    }
    box.append(
      el(
        'div',
        { class: 'proposal-save' },
        el('input', {
          id: 'newCvName',
          type: 'text',
          placeholder: 'Nom du nouveau CV',
          value: newCvNameDraft || defaultVersionName(),
          'aria-label': 'Nom du nouveau CV',
        }),
        el('button', { type: 'button', id: 'saveProposalBtn', text: 'Enregistrer ce nouveau CV' })
      ),
      el('button', { type: 'button', id: 'discardProposalBtn', class: 'ghost', text: 'Ignorer la proposition' })
    );
    if (proposalSaved) {
      box.append(el('p', { class: 'apply-note', text: 'Nouveau CV enregistré ✓ — retrouvez-le dans l’onglet « CV de base ».' }));
    }
    resultsEl.append(box);
  } else {
    const upToDate = state.experiences.every((exp) => suggestOrder(exp, model).alreadyApplied);
    resultsEl.append(
      el('p', {
        class: upToDate ? 'apply-note' : 'empty-note',
        text: upToDate
          ? 'Le CV de base est déjà dans l’ordre le plus pertinent pour cette offre ✓'
          : 'Cliquez sur « Analyser l’offre » pour obtenir un nouveau CV proposé.',
      })
    );
  }
}

resultsEl.addEventListener('click', (e) => {
  if (e.target.closest('#saveProposalBtn')) {
    saveProposalVersion();
  } else if (e.target.closest('#discardProposalBtn')) {
    // Le CV de base n'a jamais été modifié : ignorer la proposition se limite
    // à l'oublier (ré-analyser l'offre la reconstruit à l'identique).
    state.proposal = null;
    proposalSaved = false;
    rerender();
  }
});

// Le nom saisi survit aux re-rendus du panneau (chaque édition du CV en
// déclenche un), sans provoquer de re-rendu lui-même.
resultsEl.addEventListener('input', (e) => {
  if (e.target.id === 'newCvName') newCvNameDraft = e.target.value;
});

resultsEl.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && e.target.id === 'newCvName') saveProposalVersion();
});

$('#analyzeBtn').addEventListener('click', () => {
  state.jobText = jobTextEl.value;
  buildProposal();
  rerender();
});

$('#clearAnalysisBtn').addEventListener('click', async () => {
  if ((state.proposal || state.rewrite) && !(await customConfirm(
    'Effacer l’offre, la proposition et la relecture en cours ? Le CV de base n’est pas affecté, et les CV enregistrés sont conservés.',
    { confirmLabel: 'Effacer' }
  ))) return;
  state.proposal = null;
  state.rewrite = null;
  proposalSaved = false;
  newCvNameDraft = '';
  jobTextEl.value = '';
  state.jobText = '';
  rerender();
});

jobTextEl.addEventListener('input', () => {
  // L'analyse ne se relance qu'au clic sur « Analyser », mais on mémorise la saisie
  state.jobText = jobTextEl.value;
  save();
});

/* ============================================================
   Relecture : lignes d'expérience recalibrées sur l'offre
   ============================================================
   Variante « semi-auto » : l'app fabrique le prompt, l'utilisateur le passe à
   son assistant IA et recolle la réponse, puis TOUT est appliqué d'un bloc.
   Rien n'est écrit dans le CV de base : la relecture est une surcouche
   d'affichage (state.rewrite, voir normalizeRewrite) doublée d'un CV nommé
   créé automatiquement. Chaque ligne reste annulable, seule ou en bloc. */

const promptPreviewEl = $('#promptPreview');
const promptStatusEl = $('#promptStatus');
const llmAnswerEl = $('#llmAnswer');
const rewriteErrorEl = $('#rewriteError');
const rewriteReportEl = $('#rewriteReport');

/* ---------- Langue de l'offre ---------- */

// Mots-outils très fréquents et propres à chaque langue : suffisants pour
// trancher entre une offre française et une offre anglaise, sans dictionnaire.
const LANG_MARKERS = {
  fr: ['le', 'la', 'les', 'des', 'une', 'un', 'vous', 'nous', 'et', 'du', 'dans', 'pour', 'avec', 'sur', 'est', 'sont', 'au', 'aux', 'votre', 'notre', 'que', 'qui'],
  en: ['the', 'and', 'you', 'we', 'with', 'for', 'our', 'your', 'this', 'that', 'will', 'are', 'is', 'to', 'of', 'in', 'on', 'as', 'have', 'their'],
};

// Langue dominante de l'offre : les lignes recalibrées devront la suivre.
function detectOfferLang(text) {
  const words = normalizeText(text).match(/[a-z']+/g) || [];
  const counts = { fr: 0, en: 0 };
  const sets = { fr: new Set(LANG_MARKERS.fr), en: new Set(LANG_MARKERS.en) };
  for (const w of words) {
    if (sets.fr.has(w)) counts.fr += 1;
    if (sets.en.has(w)) counts.en += 1;
  }
  return counts.en > counts.fr ? 'en' : 'fr';
}

/* ---------- Fabrication du prompt ---------- */

// Nettoie une ligne venue d'un texte collé (offre ou réponse de l'assistant) :
// balisage Markdown courant, guillemets d'encadrement, espaces multiples.
function cleanRewriteLine(raw) {
  return String(raw ?? '')
    .replace(/^[\s>#]+/, '')
    .replace(/\*\*|__|`/g, '')
    .replace(/^[*_]+|[*_]+$/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/^["«“]\s*|\s*["»”]$/g, '')
    .trim();
}

// Rappel du parcours envoyé à l'assistant : il doit recalibrer, pas inventer.
function rewriteCareerBrief() {
  const out = [];
  state.experiences.forEach((exp, i) => {
    out.push(`[EXP ${i + 1}] ${exp.role || 'Poste'} — ${exp.company || 'Entreprise'}${exp.period ? ` (${exp.period})` : ''}`);
    if (exp.companyDescription.trim()) out.push(`Contexte : ${exp.companyDescription.trim()}`);
    out.push(`Lignes actuelles (${exp.bullets.length}) :`);
    exp.bullets.forEach((b, j) => out.push(`${j + 1}. ${b.text}`));
    out.push('');
  });

  const list = (title, items) => {
    const rows = items.filter(Boolean);
    if (!rows.length) return;
    out.push(title);
    rows.forEach((r) => out.push(`- ${r}`));
    out.push('');
  };
  list('Formation :', state.education.map((e) => [e.title, e.detail].filter(Boolean).join(' — ')));
  list('Projets :', state.projects.map((p) => [p.title, p.detail].filter(Boolean).join(' — ')));
  list('Compétences :', state.skillGroups.map((g) => `${g.label} : ${g.text.replace(/\n+/g, ' ; ')}`));
  if (state.skills.trim()) list('Autres compétences :', [state.skills.trim()]);
  return out.join('\n').trim();
}

// Le prompt complet : offre + parcours + anatomie imposée d'une ligne + format
// de réponse analysable par parseRewriteAnswer().
function buildRewritePrompt() {
  const offer = effectiveJobText();
  const lang = detectOfferLang(offer);
  const counts = state.experiences.map((exp, i) => `[EXP ${i + 1}] : exactement ${exp.bullets.length} ligne${exp.bullets.length > 1 ? 's' : ''}`);

  return [
    "Tu réécris les lignes d'expérience d'un CV pour qu'elles répondent à une offre d'emploi précise.",
    '',
    "## Offre d'emploi",
    '"""',
    offer,
    '"""',
    '',
    '## Parcours actuel (seule matière autorisée : n’invente rien)',
    rewriteCareerBrief(),
    '',
    '## Anatomie imposée de chaque ligne',
    "Verbe d'action au passé + objet quantifié + méthode ou outil + résultat quantifié + destinataire ou usage.",
    lang === 'en'
      ? 'Example: « Analyzed purchasing behavior of 100,000 customers through clustering to create 3 personas used by the Product, Marketing, and Purchasing teams. »'
      : 'Exemple : « Analysé le comportement d’achat de 100 000 clients par clustering pour produire 3 personas utilisés par les équipes Produit, Marketing et Achats. »',
    '',
    'Règles :',
    '- une seule phrase par ligne, sans « je », sans sous-liste ;',
    "- aucun adjectif d'auto-évaluation (« excellent », « passionné », « rigoureux ») ;",
    '- les chiffres priment, mais n’en invente aucun : n’utilise que des nombres déjà présents ' +
      'dans les lignes d’origine fournies ci-dessus ; si aucun chiffre n’est disponible pour une ' +
      'réalisation, écris la ligne sans chiffre plutôt que d’en estimer un ;',
    "- reprends le vocabulaire de l'offre uniquement quand il décrit vraiment le travail fait ;",
    lang === 'en'
      ? "- the posting is written in English: write every line in English."
      : "- l'offre est rédigée en français : rédige toutes les lignes en français.",
    '',
    '## Format de réponse imposé',
    'Réponds UNIQUEMENT par les blocs suivants, sans introduction ni commentaire :',
    '',
    state.experiences.map((_, i) => `[EXP ${i + 1}]\n- …\n- …`).join('\n\n'),
    '',
    'Une ligne par tiret, dans le même ordre que les lignes actuelles, et :',
    ...counts.map((c) => `- ${c}`),
  ].join('\n');
}

/* ---------- Copie du prompt ---------- */

function flashPromptStatus(message, ok = true) {
  promptStatusEl.textContent = message;
  promptStatusEl.classList.toggle('ko', !ok);
  promptStatusEl.hidden = false;
}

// Copie sans dépendance ni permission : l'API moderne quand elle est là (elle
// ne l'est pas toujours en file://), sinon la sélection d'un textarea.
async function copyToClipboard(text) {
  try {
    if (navigator.clipboard && window.isSecureContext) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    /* refus du navigateur : on retombe sur execCommand ci-dessous */
  }
  const ta = el('textarea', { style: 'position:fixed;top:-1000px;opacity:0' });
  ta.value = text;
  document.body.append(ta);
  ta.select();
  let ok = false;
  try {
    ok = document.execCommand('copy');
  } catch {
    ok = false;
  }
  ta.remove();
  return ok;
}

function showPrompt(open) {
  promptPreviewEl.hidden = !open;
  $('#togglePromptBtn').setAttribute('aria-expanded', String(open));
  $('#togglePromptBtn').textContent = open ? 'Masquer le prompt' : 'Voir le prompt';
  if (open) promptPreviewEl.value = buildRewritePrompt();
}

$('#copyPromptBtn').addEventListener('click', async () => {
  state.jobText = jobTextEl.value;
  if (!effectiveJobText()) {
    flashPromptStatus("Collez d'abord le texte de l'offre ci-dessus.", false);
    return;
  }
  const prompt = buildRewritePrompt();
  promptPreviewEl.value = prompt;
  const ok = await copyToClipboard(prompt);
  if (ok) {
    flashPromptStatus('Prompt copié ✓ — collez-le dans votre assistant, puis recollez sa réponse ci-dessous.');
  } else {
    showPrompt(true);
    flashPromptStatus('Copie automatique refusée par le navigateur : le prompt est affiché ci-dessous, copiez-le à la main.', false);
  }
});

$('#togglePromptBtn').addEventListener('click', () => {
  state.jobText = jobTextEl.value;
  showPrompt(promptPreviewEl.hidden);
});

$('#clearAnswerBtn').addEventListener('click', () => {
  llmAnswerEl.value = '';
  rewriteErrorEl.hidden = true;
  llmAnswerEl.focus();
});

/* ---------- Analyse de la réponse de l'assistant ---------- */

// En-tête de bloc : « [EXP 2] », « **[EXP 2]** Chef de projet… », « EXP 2 : »
const RW_HEAD_BRACKET = /^[\s>#*_]*\[\s*EXP\s*(\d+)\s*\].*$/i;
const RW_HEAD_BARE = /^[\s>#*_]*EXP\s*(\d+)\s*[:.)–—-]?[\s*_]*$/i;
// Puce : « - … », « • … », « 1. … », « 1) … »
const RW_BULLET = /^\s*(?:[-–—*•]|\d+[.)])\s+(.*)$/;

// Réponse → { numéro d'expérience → lignes }. Tolère le préambule, le
// balisage Markdown et les lignes repliées (une puce coupée sur deux lignes
// est recollée à la précédente). Un en-tête vu deux fois complète le bloc.
function parseRewriteAnswer(text) {
  const blocks = new Map();
  let current = null;
  for (const raw of String(text ?? '').replace(/\r\n?/g, '\n').split('\n')) {
    const head = raw.match(RW_HEAD_BRACKET) || raw.match(RW_HEAD_BARE);
    if (head) {
      const n = Number(head[1]);
      if (!blocks.has(n)) blocks.set(n, []);
      current = blocks.get(n);
      continue;
    }
    if (!current) continue;
    const bullet = raw.match(RW_BULLET);
    const line = cleanRewriteLine(bullet ? bullet[1] : raw);
    if (!line) continue;
    if (bullet) {
      current.push(line);
    } else if (current.length && !/[.!?»:;]$/.test(current[current.length - 1])) {
      // Suite d'une puce coupée en deux : on ne recolle que si la précédente
      // n'est pas déjà finie, sinon la phrase de conclusion de l'assistant
      // (« Dis-moi si tu veux une variante… ») atterrirait dans le CV.
      current[current.length - 1] += ' ' + line;
    }
  }
  for (const [n, lines] of blocks) if (!lines.length) blocks.delete(n);
  return blocks;
}

/* ---------- Application en bloc ---------- */

// Nom proposé pour le CV créé : entreprise + intitulé lus en tête de l'offre.
function rewriteVersionName() {
  const lines = effectiveJobText().split('\n').map(cleanRewriteLine).filter(Boolean);
  const title = (lines[0] || '')
    .replace(/\s*[(（]\s*(?:h\/f|f\/h|m\/f|h\/f\/x|w\/m|m\/w)\s*[)）]\s*$/i, '')
    .trim();
  let company = '';
  for (const l of lines.slice(1, 4)) {
    const m = l.match(/^([^—–·|,:]{2,40}?)\s*[—–·|]/);
    if (m) {
      company = m[1].trim();
      break;
    }
  }
  const name = [company, title].filter(Boolean).join(' — ');
  if (!name) return `Offre du ${new Date().toLocaleDateString('fr-FR')}`;
  return name.length > 70 ? name.slice(0, 69).trimEnd() + '…' : name;
}

// Construit la couche de relecture à partir de la réponse collée. Appariement
// POSITIONNEL : la k-ième ligne d'un bloc recalibre le k-ième tiret de
// l'expérience. Moins de lignes que de tirets → les tirets restants sont
// conservés tels quels ; plus de lignes → le surplus est ajouté en fin
// d'expérience (et reste supprimable).
function buildRewriteEntries(blocks) {
  const entries = {};
  state.experiences.forEach((exp, i) => {
    const lines = blocks.get(i + 1);
    if (!lines || !lines.length) return;
    const list = [];
    exp.bullets.forEach((b, j) => {
      const after = lines[j];
      if (after === undefined) return; // moins de lignes que de tirets : tiret conservé
      list.push({ id: uid(), kind: 'edit', bulletId: b.id, before: b.text, after, active: true });
    });
    lines.slice(exp.bullets.length).forEach((after) => {
      list.push({ id: uid(), kind: 'add', bulletId: null, before: '', after, active: true });
    });
    if (list.length) entries[exp.id] = list;
  });
  return entries;
}

// Compteurs du rapport, recalculés à chaque rendu : ils survivent ainsi au
// rechargement de la page et suivent les tirets ajoutés ou supprimés depuis.
function rewriteStats() {
  const s = { rewritten: 0, unchanged: 0, kept: 0, added: 0 };
  if (!state.rewrite) return s;
  for (const exp of state.experiences) {
    const list = rewriteEntriesFor(exp.id) || [];
    let edits = 0;
    for (const e of list) {
      if (e.kind === 'add') {
        s.added += 1;
      } else {
        edits += 1;
        if (e.after === baseTextFor(exp.id, e)) s.unchanged += 1;
        else s.rewritten += 1;
      }
    }
    s.kept += Math.max(0, exp.bullets.length - edits);
  }
  return s;
}

// Le CV tel qu'il s'affiche pendant la relecture : ordre proposé par l'analyse
// + textes recalibrés actifs + lignes ajoutées actives. C'est ce qui est
// enregistré dans le CV nommé.
function snapshotRewriteCV() {
  const snap = snapshotProposalCV();
  if (!state.rewrite) return snap;
  for (const exp of snap.experiences) {
    const list = state.rewrite.entries[exp.id];
    if (!list) continue;
    const edits = new Map();
    for (const e of list) if (e.kind === 'edit' && e.active) edits.set(e.bulletId, e.after);
    exp.bullets = exp.bullets.map((b) => (edits.has(b.id) ? { ...b, text: edits.get(b.id) } : b));
    for (const e of list) if (e.kind === 'add' && e.active) exp.bullets.push({ id: e.id, text: e.after });
  }
  return snap;
}

// Le CV nommé suit la relecture : chaque annulation, rétablissement ou
// retouche de texte y est reportée. Si l'utilisateur l'a supprimé de la liste,
// on cesse simplement de le suivre.
function syncRewriteVersion() {
  if (!state.rewrite || !state.rewrite.versionId) return;
  const v = state.versions.find((x) => x.id === state.rewrite.versionId);
  if (!v) {
    state.rewrite.versionId = null;
    return;
  }
  v.data = snapshotRewriteCV();
}

async function applyRewriteAnswer() {
  rewriteErrorEl.hidden = true;
  state.jobText = jobTextEl.value;
  if (!effectiveJobText()) {
    return showRewriteError("Collez d'abord le texte de l'offre ci-dessus.");
  }
  const answer = llmAnswerEl.value.trim();
  if (!answer) {
    return showRewriteError("Collez la réponse de votre assistant avant d'appliquer.");
  }
  const blocks = parseRewriteAnswer(answer);
  if (blocks.size === 0) {
    return showRewriteError(
      'Format non reconnu : la réponse doit contenir des blocs « [EXP 1] », « [EXP 2] »… suivis de lignes à tiret. Vérifiez que le prompt a bien été copié en entier.'
    );
  }
  const entries = buildRewriteEntries(blocks);
  if (Object.keys(entries).length === 0) {
    return showRewriteError("Aucune ligne exploitable : les blocs trouvés ne correspondent à aucune expérience du CV.");
  }
  // Une relecture en cours serait remplacée : le CV nommé déjà créé est
  // réutilisé, pour ne pas empiler les sauvegardes à chaque nouvel essai.
  const previous = state.rewrite;
  if (previous && !(await customConfirm(
    'Remplacer la relecture en cours par cette nouvelle réponse ? Les annulations déjà faites seront perdues.',
    { confirmLabel: 'Remplacer' }
  ))) return;

  const reusable = previous && previous.versionId && state.versions.find((x) => x.id === previous.versionId);
  state.rewrite = {
    createdAt: Date.now(),
    versionId: reusable ? reusable.id : null,
    name: reusable ? reusable.name : rewriteVersionName(),
    lang: detectOfferLang(effectiveJobText()),
    jobText: effectiveJobText(),
    entries,
  };
  if (reusable) {
    reusable.data = snapshotRewriteCV();
    reusable.createdAt = Date.now();
  } else {
    const v = { id: uid(), name: state.rewrite.name, createdAt: Date.now(), data: snapshotRewriteCV() };
    state.rewrite.versionId = v.id;
    state.versions.unshift(v);
  }
  rerender();
}

function showRewriteError(message) {
  rewriteErrorEl.textContent = message;
  rewriteErrorEl.hidden = false;
}

/* ---------- Couche d'affichage ---------- */

// Lignes recalibrées d'une expérience (null hors relecture).
function rewriteEntriesFor(expId) {
  return (state.rewrite && state.rewrite.entries[expId]) || null;
}

// Entrée de relecture correspondant à un tiret affiché : soit le tiret du CV
// de base qu'elle recalibre, soit la ligne ajoutée qu'elle est elle-même.
function rewriteEntryForBullet(expId, bulletId) {
  const list = inCreateTab() ? rewriteEntriesFor(expId) : null;
  if (!list) return null;
  return list.find((e) => e.active && (e.kind === 'add' ? e.id === bulletId : e.bulletId === bulletId)) || null;
}

// Superpose les textes recalibrés et les lignes ajoutées à la liste affichée.
// Les objets renvoyés portent `rw` (« edit » / « add »), `rwBefore` et
// `rwEntryId` pour le rendu des badges — les tirets inchangés restent les
// objets du CV de base.
function applyRewriteLayer(exp, bullets) {
  const list = inCreateTab() ? rewriteEntriesFor(exp.id) : null;
  if (!list) return bullets;
  const sourcePool = rewriteSourceNumberPool();
  const numAlert = (e) => unverifiedNumbers(exp.id, e, sourcePool).length;
  const edits = new Map();
  for (const e of list) if (e.kind === 'edit' && e.active) edits.set(e.bulletId, e);
  const out = bullets.map((b) => {
    const e = edits.get(b.id);
    return e ? { id: b.id, text: e.after, rw: 'edit', rwBefore: e.before, rwEntryId: e.id, rwNumAlert: numAlert(e) } : b;
  });
  for (const e of list) {
    if (e.kind === 'add' && e.active) out.push({ id: e.id, text: e.after, rw: 'add', rwBefore: '', rwEntryId: e.id, rwNumAlert: numAlert(e) });
  }
  return out;
}

// Un tiret supprimé du CV de base emporte la ligne recalibrée qui le visait.
function rewriteRemoveBullet(expId, bulletId) {
  const list = rewriteEntriesFor(expId);
  if (!list) return;
  const next = list.filter((e) => (e.kind === 'add' ? e.id !== bulletId : e.bulletId !== bulletId));
  if (next.length) state.rewrite.entries[expId] = next;
  else delete state.rewrite.entries[expId];
  dropEmptyRewrite();
}

// Une relecture qui n'a plus aucune ligne n'existe plus : sans cela le panneau
// resterait ouvert et vide, et le rechargement de la page (où normalizeRewrite
// écarte les relectures vides) donnerait un autre résultat.
function dropEmptyRewrite() {
  if (state.rewrite && Object.keys(state.rewrite.entries).length === 0) state.rewrite = null;
}

/* ---------- Rapport de relecture ---------- */

// Report différé du texte retouché vers le CV nommé : la saisie ne doit pas
// recopier tout le CV à chaque frappe.
let rewriteSyncTimer = null;
function scheduleRewriteSync() {
  clearTimeout(rewriteSyncTimer);
  rewriteSyncTimer = setTimeout(() => {
    syncRewriteVersion();
    renderRewritePanel();
    save();
  }, 400);
}

function rewriteVersion() {
  return (state.rewrite && state.versions.find((v) => v.id === state.rewrite.versionId)) || null;
}

/* ---------- Diff mot à mot ---------- */

// Comparaison souple : casse, accents et ponctuation finale ne comptent pas,
// pour ne surligner que les vraies différences de fond.
function diffWordKey(w) {
  return normalizeText(w).replace(/^[^a-z0-9]+|[^a-z0-9]+$/g, '');
}

// Diff mot à mot par plus longue sous-séquence commune. Renvoie deux listes de
// jetons { t, on } — `on` marquant les mots retirés (avant) ou ajoutés (après).
function wordDiff(before, after) {
  const A = before.match(/\S+/g) || [];
  const B = after.match(/\S+/g) || [];
  // Lignes anormalement longues : on affiche les deux textes en entier plutôt
  // que de calculer une matrice qui n'apprendrait rien.
  if (A.length * B.length > 40000) {
    return { a: A.map((t) => ({ t, on: true })), b: B.map((t) => ({ t, on: true })) };
  }
  const ka = A.map(diffWordKey);
  const kb = B.map(diffWordKey);
  const m = A.length;
  const n = B.length;
  const L = Array.from({ length: m + 1 }, () => new Uint16Array(n + 1));
  for (let i = m - 1; i >= 0; i--) {
    for (let j = n - 1; j >= 0; j--) {
      L[i][j] = ka[i] === kb[j] ? L[i + 1][j + 1] + 1 : Math.max(L[i + 1][j], L[i][j + 1]);
    }
  }
  const a = [];
  const b = [];
  let i = 0;
  let j = 0;
  while (i < m && j < n) {
    if (ka[i] === kb[j]) {
      a.push({ t: A[i++] });
      b.push({ t: B[j++] });
    } else if (L[i + 1][j] >= L[i][j + 1]) {
      a.push({ t: A[i++], on: true });
    } else {
      b.push({ t: B[j++], on: true });
    }
  }
  while (i < m) a.push({ t: A[i++], on: true });
  while (j < n) b.push({ t: B[j++], on: true });
  return { a, b };
}

function diffLineEl(tokens, cls) {
  const node = el('div', { class: cls });
  tokens.forEach((tk, i) => {
    if (i) node.append(' ');
    if (!tk.on) {
      node.append(tk.t);
      return;
    }
    node.append(
      el('span', {
        class: 'w' + (tk.numAlert ? ' num-alert' : ''),
        title: tk.numAlert
          ? 'Chiffre introuvable dans le CV de base — vérifiez-le avant d’exporter.'
          : undefined,
        text: tk.t,
      })
    );
  });
  return node;
}

/* ---------- Provenance des chiffres ----------
   Le LLM peut inventer un chiffre : toute la valeur d'une ligne recalibrée
   tient à ses nombres, donc un chiffre halluciné part directement chez un
   recruteur. On extrait les nombres de chaque ligne appliquée et on les
   compare à ceux du tiret d'origine puis, à défaut, à l'ensemble du CV
   source — jamais stocké, recalculé au rendu comme rewriteStats(). */

// Cœur numérique + multiplicateur (k/K/M) + unité (%/€/$), ou notation
// scientifique (1e5) : couvre les formats vus dans ce dépôt (« 600 k€ »,
// « 80 % », l'exemple du prompt « 100,000 » / « 100 000 ») et les variantes
// qu'une réponse de LLM peut employer (espace insécable, « 100k », « 2,4 M »).
const NUMBER_RE = /(\d+(?:\.\d+)?[eE][+-]?\d+)|(\d(?:[\d\s .,]*\d)?)(?:\s?(k|K|M))?(?:\s?(%|€|\$))?/g;

// Cœur de chiffres → valeur : les espaces (dont insécables) sont toujours des
// séparateurs de milliers ; une virgule ou un point suivi d'exactement 3
// chiffres (répétable) aussi ; le dernier séparateur restant, suivi de 1 ou 2
// chiffres, est la décimale. Couvre à la fois « 100 000 » et « 100,000 ».
function parseNumberCore(raw) {
  const s = raw.replace(/[\s ]/g, '');
  const m = s.match(/^(\d+(?:[.,]\d{3})*)([.,](\d{1,2}))?$/);
  if (!m) {
    const n = parseFloat(s.replace(/[.,]/g, '.'));
    return Number.isFinite(n) ? n : null;
  }
  const intPart = m[1].replace(/[.,]/g, '');
  const n = parseFloat(m[3] ? `${intPart}.${m[3]}` : intPart);
  return Number.isFinite(n) ? n : null;
}

function numberSuffixMultiplier(mult) {
  if (!mult) return 1;
  const m = mult.toLowerCase();
  return m === 'k' ? 1000 : m === 'm' ? 1000000 : 1;
}

// Chiffres pleine chasse (unicode０-９, saisie possible depuis un IME) →
// chiffres ASCII, avant toute extraction : sans ça NUMBER_RE (\d ASCII
// uniquement) ne les voit jamais et un chiffre inventé passe inaperçu.
function normalizeDigits(text) {
  return String(text ?? '').replace(/[０-９]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0xff10 + 48));
}

// Toutes les valeurs numériques d'un texte, canonicalisées : « 100 000 »,
// « 100,000 », « 100k » et « 1e5 » donnent la même valeur, comparable entre
// deux textes sans se soucier du format d'origine.
function extractNumbers(text) {
  const out = new Set();
  const re = new RegExp(NUMBER_RE.source, 'g');
  let m;
  while ((m = re.exec(normalizeDigits(text)))) {
    let n;
    if (m[1]) {
      n = parseFloat(m[1]);
    } else {
      const core = parseNumberCore(m[2]);
      if (core === null) continue;
      n = core * numberSuffixMultiplier(m[3]);
    }
    if (Number.isFinite(n)) out.add(Math.round(n * 100) / 100);
  }
  return out;
}

// Pool « CV source » du repli : construit à partir des champs bruts (jamais
// du texte formaté pour le LLM) pour ne pas hériter de la numérotation
// d'affichage de rewriteCareerBrief() (« [EXP 1] », « Lignes actuelles (3) »,
// préfixes « 1. »/« 2. ») — sinon ces artefacts de mise en forme sont pris
// pour des chiffres réels du CV et blanchissent n'importe quel petit entier
// inventé. Calculé une seule fois par rendu plutôt que par ligne.
function rewriteSourceNumberPool() {
  const parts = [];
  state.experiences.forEach((exp) => {
    parts.push(exp.role, exp.company, exp.period, exp.companyDescription);
    exp.bullets.forEach((b) => parts.push(b.text));
  });
  state.education.forEach((e) => {
    parts.push(e.title, e.detail);
    (e.bullets || []).forEach((b) => parts.push(b.text));
  });
  state.projects.forEach((p) => {
    parts.push(p.title, p.detail);
    (p.bullets || []).forEach((b) => parts.push(b.text));
  });
  state.skillGroups.forEach((g) => parts.push(g.label, g.text));
  parts.push(state.skills, state.profile.summary);
  return extractNumbers(parts.filter(Boolean).join('\n'));
}

// Valeurs numériques de la ligne recalibrée introuvables dans le tiret
// d'origine ni, à défaut, dans le reste du CV. Repli volontairement plus
// faible que la comparaison au tiret (cf. limites dans le README) : un
// chiffre présent ailleurs dans le CV mais attaché à la mauvaise réalisation
// passera pour vérifié.
function unverifiedNumbers(expId, entry, sourcePool) {
  const bulletPool = entry.kind === 'add' ? new Set() : extractNumbers(baseTextFor(expId, entry));
  const pool = sourcePool || rewriteSourceNumberPool();
  const after = extractNumbers(entry.after);
  return [...after].filter((n) => !bulletPool.has(n) && !pool.has(n));
}

// Marque, parmi des jetons déjà diffés (wordDiff), ceux qui portent un
// chiffre non vérifié — pour les distinguer d'un simple mot modifié.
function markUnverifiedTokens(tokens, unverifiedSet) {
  if (!unverifiedSet.size) return tokens;
  return tokens.map((tk) => {
    if (!tk.on) return tk;
    for (const n of extractNumbers(tk.t)) if (unverifiedSet.has(n)) return { ...tk, numAlert: true };
    return tk;
  });
}

/* ---------- Rendu du rapport ---------- */

// Texte du CV de base visé par une entrée, tel qu'il est AUJOURD'HUI : c'est
// lui qui réapparaît quand on annule la ligne, pas le `before` figé.
function baseTextFor(expId, entry) {
  if (entry.kind === 'add') return '';
  const exp = findExp(expId);
  const b = exp && exp.bullets.find((x) => x.id === entry.bulletId);
  return b ? b.text : entry.before;
}

// Accord simple : "1 ligne réécrite" / "3 lignes réécrites". Partagé entre le
// rapport et chaque ligne (badge de chiffres à vérifier).
const plural = (n, one, many) => `${n} ${n > 1 ? many : one}`;

function rewriteLineItem(expId, entry, sourcePool) {
  const base = baseTextFor(expId, entry);
  const isAdd = entry.kind === 'add';
  const same = !isAdd && base === entry.after;
  // Chiffres de la ligne appliquée introuvables dans le tiret d'origine ni le
  // reste du CV — non pertinent pour une ligne inchangée (base === after, donc
  // trivialement vérifiée) ni pour une ligne désactivée (le texte affiché
  // redevient celui du CV de base).
  const unverified = !same && entry.active ? unverifiedNumbers(expId, entry, sourcePool) : [];
  const li = el('li', {
    class: 'rw-line' + (entry.active ? '' : ' off') + (isAdd ? ' add' : '') + (same ? ' same' : '') + (unverified.length ? ' num-flag' : ''),
    'data-entry': entry.id,
  });

  const tag = isAdd ? 'ligne ajoutée' : same ? 'inchangée' : entry.active ? 'réécrite' : 'annulée';
  li.append(
    el(
      'div',
      { class: 'rw-line-top' },
      el('span', { class: 'rw-tag', text: tag }),
      unverified.length &&
        el('span', {
          class: 'rw-num-badge',
          title: 'Chiffre(s) introuvable(s) dans le CV de base — à vérifier avant d’exporter.',
          text: `⚠ ${plural(unverified.length, 'chiffre à vérifier', 'chiffres à vérifier')}`,
        }),
      el('button', {
        type: 'button',
        class: 'ghost rw-toggle',
        'data-rw': 'toggle',
        title: entry.active
          ? (isAdd ? 'Retirer cette ligne ajoutée' : 'Revenir au texte du CV de base')
          : 'Réappliquer la ligne recalibrée',
        text: entry.active ? 'Annuler' : 'Rétablir',
      })
    )
  );

  const unverifiedSet = new Set(unverified);
  if (isAdd) {
    const tokens = (entry.after.match(/\S+/g) || []).map((t) => ({ t, on: true }));
    li.append(diffLineEl(markUnverifiedTokens(tokens, unverifiedSet), 'rw-after'));
  } else if (same) {
    li.append(diffLineEl([{ t: entry.after }], 'rw-after'));
  } else {
    const { a, b } = wordDiff(base, entry.after);
    li.append(diffLineEl(a, 'rw-before'), diffLineEl(markUnverifiedTokens(b, unverifiedSet), 'rw-after'));
  }
  return li;
}

function renderRewritePanel() {
  rewriteReportEl.textContent = '';
  const rw = state.rewrite;
  if (!rw) return;

  const s = rewriteStats();
  const parts = [plural(s.rewritten, 'ligne réécrite', 'lignes réécrites')];
  if (s.unchanged) parts.push(plural(s.unchanged, 'inchangée', 'inchangées'));
  if (s.added) parts.push(plural(s.added, 'ajoutée', 'ajoutées'));
  if (s.kept) parts.push(plural(s.kept, 'tiret conservé', 'tirets conservés'));

  const all = Object.values(rw.entries).flat();
  const off = all.filter((e) => !e.active).length;

  // Pool « CV source » calculé une seule fois pour tout le rapport, pas par
  // ligne — rewriteCareerBrief() reconstruit une chaîne à chaque appel.
  const sourcePool = rewriteSourceNumberPool();
  let numAlertCount = 0;
  for (const [expId, list] of Object.entries(rw.entries)) {
    for (const e of list) {
      if (!e.active) continue;
      if (e.kind !== 'add' && baseTextFor(expId, e) === e.after) continue; // inchangée : trivialement vérifiée
      numAlertCount += unverifiedNumbers(expId, e, sourcePool).length;
    }
  }

  const box = el('div', { class: 'rw-report' });
  box.append(
    el('div', { class: 'rw-summary', text: parts.join(' · ') }),
    el('p', {
      class: 'hint rw-hint',
      text: off
        ? `${plural(off, 'ligne annulée', 'lignes annulées')} sur ${all.length} — les lignes annulées reprennent le texte du CV de base.`
        : 'Tout est appliqué. Relisez ligne à ligne : le texte barré est celui du CV de base, qui n’a pas bougé.',
    })
  );

  if (numAlertCount > 0) {
    box.append(
      el('p', {
        class: 'rw-numbanner',
        role: 'alert',
        text: `⚠ ${plural(numAlertCount, 'chiffre à vérifier', 'chiffres à vérifier')} — introuvable${numAlertCount > 1 ? 's' : ''} dans le CV de base, repérez-le${numAlertCount > 1 ? 's' : ''} dans le détail ci-dessous avant d’exporter.`,
      })
    );
  }

  const v = rewriteVersion();
  box.append(
    el(
      'div',
      { class: 'rw-version' },
      el('label', { class: 'rw-version-label', for: 'rwName', text: v ? 'CV créé ✓' : 'CV supprimé' }),
      el('input', {
        id: 'rwName',
        type: 'text',
        value: rw.name,
        disabled: v ? undefined : '',
        'aria-label': 'Nom du CV créé',
      })
    )
  );

  if (rw.jobText !== effectiveJobText()) {
    box.append(el('p', { class: 'rw-stale', text: 'L’offre a changé depuis cette relecture — recopiez le prompt pour la remettre à jour.' }));
  }

  box.append(
    el(
      'div',
      { class: 'panel-actions rw-global' },
      el('button', { type: 'button', class: 'ghost', 'data-rw': 'all-off', disabled: off === all.length ? '' : undefined, text: 'Tout annuler' }),
      el('button', { type: 'button', class: 'ghost', 'data-rw': 'all-on', disabled: off === 0 ? '' : undefined, text: 'Tout réappliquer' }),
      el('button', { type: 'button', class: 'ghost danger', 'data-rw': 'discard', text: 'Abandonner' })
    )
  );

  for (const exp of state.experiences) {
    const list = rewriteEntriesFor(exp.id);
    const kept = Math.max(0, exp.bullets.length - (list ? list.filter((e) => e.kind === 'edit').length : 0));
    if (!list && !kept) continue;
    const block = el('div', { class: 'rw-exp' }, el('h4', { text: exp.role || 'Expérience' }));
    if (list) block.append(el('ol', { class: 'rw-lines' }, ...list.map((e) => rewriteLineItem(exp.id, e, sourcePool))));
    if (kept > 0) {
      block.append(
        el('p', {
          class: 'rw-kept',
          text: `${plural(kept, 'tiret du CV de base conservé tel quel', 'tirets du CV de base conservés tels quels')} (l’assistant n’a pas rendu de ligne pour ${kept > 1 ? 'eux' : 'lui'}).`,
        })
      );
    }
    box.append(block);
  }

  rewriteReportEl.append(box);
}

// Bascule d'une ligne : la couche est la seule à changer, le CV nommé suit.
function setRewriteEntryActive(entryId, active) {
  for (const list of Object.values(state.rewrite.entries)) {
    const e = list.find((x) => x.id === entryId);
    if (e) {
      e.active = active;
      return true;
    }
  }
  return false;
}

function setAllRewriteActive(active) {
  for (const list of Object.values(state.rewrite.entries)) for (const e of list) e.active = active;
}

// Abandonner : la couche disparaît, le CV redevient celui de base. Le CV nommé
// déjà créé, lui, reste dans la liste des sauvegardes — rien n'est perdu.
async function discardRewrite() {
  if (!(await customConfirm(
    'Abandonner la relecture ? Le CV affiché revient au texte du CV de base ; le CV enregistré reste dans « CV sauvegardés ».',
    { confirmLabel: 'Abandonner' }
  ))) return;
  state.rewrite = null;
  rerender();
}

rewriteReportEl.addEventListener('click', (e) => {
  const btn = e.target.closest('button[data-rw]');
  if (!btn || !state.rewrite) return;
  switch (btn.dataset.rw) {
    case 'toggle': {
      const li = btn.closest('.rw-line');
      if (!li || !setRewriteEntryActive(li.dataset.entry, li.classList.contains('off'))) return;
      break;
    }
    case 'all-off':
      setAllRewriteActive(false);
      break;
    case 'all-on':
      setAllRewriteActive(true);
      break;
    case 'discard':
      discardRewrite();
      return;
    default:
      return;
  }
  syncRewriteVersion();
  rerender();
});

// Renommer le CV créé depuis le panneau, sans re-rendre (le champ garderait
// le curseur) : le nom part directement dans la sauvegarde.
rewriteReportEl.addEventListener('input', (e) => {
  if (e.target.id !== 'rwName' || !state.rewrite) return;
  state.rewrite.name = e.target.value;
  const v = rewriteVersion();
  if (v) v.name = e.target.value;
  save();
  renderVersions();
});

$('#applyRewriteBtn').addEventListener('click', applyRewriteAnswer);

/* ============================================================
   Barre d'outils
   ============================================================ */

$('#tabCreate').addEventListener('click', () => {
  state.activeTab = 'create';
  rerender();
});

$('#tabBase').addEventListener('click', () => {
  state.activeTab = 'base';
  rerender();
});

$('#tplPro').addEventListener('click', () => {
  state.template = 'pro';
  rerender();
});

$('#tplDesign').addEventListener('click', () => {
  state.template = 'design';
  rerender();
});

$('#printBtn').addEventListener('click', () => window.print());

// Téléchargement PDF, deux voies — les deux produisent du texte vectoriel
// sélectionnable, donc lisible par les ATS :
// 1. Backend (server.js + Chrome headless) : le PDF est mis en page par le
//    même moteur que l'écran — correspondance exacte (polices, retours à la
//    ligne).
// 2. Secours sans backend : générateur client pdf.js (métriques Helvetica),
//    fidèle mais avec de possibles écarts de coupure de ligne.
const PDF_ENDPOINT = location.protocol === 'file:' ? 'http://localhost:3333/pdf' : '/pdf';

async function backendPdf() {
  const res = await fetch(PDF_ENDPOINT, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ html: cvEl.outerHTML }),
  });
  if (!res.ok) throw new Error(`backend PDF : HTTP ${res.status}`);
  const blob = await res.blob();
  if (blob.type !== 'application/pdf') throw new Error('backend PDF : réponse inattendue');
  return blob;
}
$('#pdfBtn').addEventListener('click', async () => {
  const btn = $('#pdfBtn');
  btn.disabled = true;
  const label = btn.textContent;
  btn.textContent = 'Génération…';
  try {
    let blob;
    try {
      blob = await backendPdf();
    } catch (err) {
      console.info('Backend PDF indisponible, génération côté client.', err);
      // Même ordre de tirets que la feuille affichée : celui de la
      // proposition dans l'onglet « Nouveau CV », celui du CV de base sinon.
      blob = await generateCvPdf({
        ...state,
        experiences: state.experiences.map((e) => ({ ...e, bullets: displayBullets(e) })),
      });
    }
    const name = (state.profile.name || 'CV').trim().replace(/[\\/:*?"<>|]+/g, ' ').replace(/\s+/g, ' ');
    const a = el('a', { href: URL.createObjectURL(blob), download: `CV - ${name}.pdf` });
    document.body.append(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(a.href);
  } catch (err) {
    console.error(err);
    alert('La génération du PDF a échoué. Vous pouvez utiliser « Imprimer » en attendant.');
  } finally {
    btn.disabled = false;
    btn.textContent = label;
  }
});

$('#resetBtn').addEventListener('click', async () => {
  if (!(await customConfirm('Réinitialiser le CV avec le contenu d’exemple ? Les versions sauvegardées sont conservées.', { confirmLabel: 'Réinitialiser', danger: true }))) return;
  const { versions, activeTab } = state;
  state = { ...defaultCV(), versions, activeVersionId: null, proposal: null, rewrite: null, activeTab };
  jobTextEl.value = '';
  rerender();
});

$('#exportBtn').addEventListener('click', () => {
  const blob = new Blob([JSON.stringify(state, null, 2)], { type: 'application/json' });
  const a = el('a', { href: URL.createObjectURL(blob), download: 'cv.json' });
  document.body.append(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(a.href);
});

$('#importBtn').addEventListener('click', () => $('#importFile').click());

$('#importFile').addEventListener('change', (e) => {
  const file = e.target.files[0];
  e.target.value = '';
  if (!file) return;
  const reader = new FileReader();
  reader.onload = () => {
    try {
      const data = JSON.parse(reader.result);
      if (!data || typeof data !== 'object' || !data.profile || !Array.isArray(data.experiences)) {
        throw new Error('format');
      }
      state = normalizeState(data);
      jobTextEl.value = state.jobText;
      rerender();
    } catch {
      alert('Fichier invalide : attendu un export JSON de cet éditeur.');
    }
  };
  reader.readAsText(file);
});

/* ---------- Démarrage ---------- */

jobTextEl.value = state.jobText;
rerender();
