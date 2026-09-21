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
        maxVisible: null,
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
        maxVisible: null,
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
        maxVisible: null,
      },
      { id: uid(), title: 'Licence Informatique', detail: 'Université de Lyon (2017)', bullets: [], maxVisible: null },
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
        maxVisible: null,
      },
      {
        id: uid(),
        title: 'Générateur de CV open source',
        detail: 'JavaScript sans dépendance (2022)',
        bullets: [{ id: uid(), text: '300 étoiles sur GitHub' }],
        maxVisible: null,
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
  const s = { ...defaultCV(), versions: [], activeVersionId: null, proposal: null, activeTab: 'create', recentColors: [] };
  // Amorçage unique de la Bibliothèque à partir du CV d'exemple : simple
  // valeur de départ (pour ne pas repartir de zéro), aucun lien permanent
  // avec le CV ensuite — voir le commentaire détaillé dans normalizeState().
  s.library = libraryFromCV(s);
  return s;
}

/* ---------- Chargement / sauvegarde ---------- */

function normalizeBullets(list) {
  return (Array.isArray(list) ? list : []).map((b) =>
    typeof b === 'string' ? { id: uid(), text: b } : { id: (b && b.id) || uid(), text: String((b && b.text) ?? '') }
  );
}

// Limite d'affichage d'un bloc (expérience, formation, projet) : nombre de
// tirets montrés, dans l'ordre courant (analyse d'offre ou glissé-déposé).
// `null` = pas de limite, tout s'affiche. Les tirets au-delà restent
// enregistrés, seul l'affichage est tronqué.
function normalizeMaxVisible(v, total) {
  if (typeof v !== 'number' || !Number.isFinite(v)) return null;
  return Math.max(0, Math.min(total, Math.round(v)));
}

// normalizeSubsections() ne connaît pas `maxVisible` (la Bibliothèque, qui la
// réutilisera telle quelle, n'en a pas besoin). On le rapplique ici par-dessus
// son résultat, en relisant la valeur brute dans la liste source d'origine
// (même ordre, même longueur, puisque normalizeSubsections() fait un simple
// `.map()`).
function withMaxVisible(normalizedList, rawList) {
  const raw = Array.isArray(rawList) ? rawList : [];
  return normalizedList.map((item, i) => ({
    ...item,
    maxVisible: normalizeMaxVisible(raw[i] && raw[i].maxVisible, item.bullets.length),
  }));
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

/* ---------- Bibliothèque ----------
   Réservoir de contenu réutilisable, séparé du CV de base (futur onglet
   « Bibliothèque ») : l'utilisateur pourra y stocker bien plus de contenu que
   ce qui tient sur une page. Ne porte QUE du contenu réutilisable — contact,
   liens, expériences, formation, projets, compétences, centres d'intérêt —
   jamais de mise en forme (nom, titre, résumé, photo, gabarit, couleurs…) ni
   de `maxVisible` : la Bibliothèque n'a pas de limite d'affichage, c'est le
   réservoir, il contient tout. */

// Amorçage : copie du contenu du CV donné, sans maxVisible. N'est appelé
// qu'une fois (voir defaultState/normalizeState) — ensuite CV et Bibliothèque
// divergent librement, aucun lien permanent entre eux.
function libraryFromCV(cv) {
  const stripMaxVisible = (list) =>
    JSON.parse(JSON.stringify(list)).map((item) => {
      delete item.maxVisible;
      return item;
    });
  return {
    contact: JSON.parse(JSON.stringify(cv.profile.contact)),
    links: JSON.parse(JSON.stringify(cv.profile.links)),
    experiences: stripMaxVisible(cv.experiences),
    education: stripMaxVisible(cv.education),
    projects: stripMaxVisible(cv.projects),
    skills: cv.skills,
    skillGroups: JSON.parse(JSON.stringify(cv.skillGroups)),
    interests: JSON.parse(JSON.stringify(cv.interests)),
  };
}

// Normalisation de la Bibliothèque, sur le modèle de normalizeCV() : même
// repli tolérant (valeur absente/invalide → repli sûr). Réutilise telles
// quelles normalizeBullets() et normalizeSubsections() — c'est précisément
// pour ça qu'elles ne connaissent pas `maxVisible`. Pour contact/links, même
// forme que profile.contact/profile.links, mais SANS le code de migration
// des tout premiers formats (normalizeContact) : la Bibliothèque n'a pas ce
// passé, elle n'existe que depuis ce commit.
function normalizeLibrary(raw) {
  const data = raw && typeof raw === 'object' ? raw : {};
  return {
    contact: (Array.isArray(data.contact) ? data.contact : []).map((c) => ({
      id: (c && c.id) || uid(),
      label: String((c && c.label) ?? ''),
      value: String((c && c.value) ?? ''),
    })),
    links: (Array.isArray(data.links) ? data.links : []).map((l) => ({
      id: (l && l.id) || uid(),
      label: String((l && l.label) ?? ''),
      url: String((l && l.url) ?? ''),
    })),
    experiences: (Array.isArray(data.experiences) ? data.experiences : []).map((e) => ({
      id: (e && e.id) || uid(),
      role: String((e && e.role) ?? ''),
      company: String((e && e.company) ?? ''),
      period: String((e && e.period) ?? ''),
      companyDescription: String((e && e.companyDescription) ?? ''),
      bullets: normalizeBullets(e && e.bullets),
    })),
    education: normalizeSubsections(data.education),
    projects: normalizeSubsections(data.projects),
    skills: typeof data.skills === 'string' ? data.skills : '',
    skillGroups: (Array.isArray(data.skillGroups) ? data.skillGroups : []).map((g) => ({
      id: (g && g.id) || uid(),
      label: String((g && g.label) ?? ''),
      text: String((g && g.text) ?? ''),
    })),
    interests: (Array.isArray(data.interests) ? data.interests : []).map((it) =>
      typeof it === 'string' ? { id: uid(), text: it } : { id: (it && it.id) || uid(), text: String((it && it.text) ?? '') }
    ),
  };
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
    experiences: (Array.isArray(data.experiences) ? data.experiences : []).map((e) => {
      const bullets = normalizeBullets(e.bullets);
      return {
        id: e.id || uid(),
        role: String(e.role ?? ''),
        company: String(e.company ?? ''),
        period: String(e.period ?? ''),
        companyDescription: String(e.companyDescription ?? ''),
        bullets,
        maxVisible: normalizeMaxVisible(e.maxVisible, bullets.length),
      };
    }),
    education: withMaxVisible(normalizeSubsections(data.education), data.education),
    // Sauvegardes antérieures à la section « Projets » : pas de clé `projects`.
    // On repart d'une liste vide plutôt que des exemples, pour ne jamais
    // injecter de faux contenu dans un CV réel déjà rempli.
    projects: withMaxVisible(normalizeSubsections(data.projects), data.projects),
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
  // de base (s.experiences) n'est jamais réordonné ni réécrit par l'analyse :
  // la proposition n'est qu'une surcouche d'ordre, affichée dans l'onglet
  // « Nouveau CV » et enregistrable comme CV sauvegardé. D'anciennes données
  // (proposal.texts, ex-feature de reformulation par chatbot) sont ignorées.
  s.proposal = null;
  const p = data.proposal;
  if (p && typeof p === 'object' && p.orders && typeof p.orders === 'object') {
    const orders = {};
    for (const [expId, ids] of Object.entries(p.orders)) {
      if (Array.isArray(ids)) orders[expId] = ids.map(String);
    }
    if (Object.keys(orders).length > 0) {
      s.proposal = { orders };
    }
  }
  // d'anciennes données peuvent contenir data.rewrite (ex-feature de
  // recalibrage semi-auto) : ignoré, il n'existe plus dans l'état.
  s.activeTab = ['base', 'library'].includes(data.activeTab) ? data.activeTab : 'create';
  // Bibliothèque : on teste la PRÉSENCE de la clé (`'library' in data`), pas
  // sa validité (`data.library && ...`) — si elle existe mais est malformée,
  // normalizeLibrary() la répare quand même. Un test de validité ferait
  // ré-amorcer la Bibliothèque à partir du CV courant à la moindre anomalie
  // passagère (import partiel, état en cours de migration…), écrasant
  // silencieusement tout le travail déjà fait dans l'onglet Bibliothèque.
  // L'amorçage par copie du CV n'a lieu qu'une fois, à la toute première
  // absence de la clé (CV existant d'avant cette fonctionnalité) : ensuite,
  // CV et Bibliothèque n'ont plus aucun lien, ils évoluent chacun de leur
  // côté.
  s.library = 'library' in data ? normalizeLibrary(data.library) : libraryFromCV(s);
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

// `grouped` : cette sauvegarde fait partie d'une interaction continue (frappe
// dans un champ, glissement d'un curseur) et doit fusionner avec la
// précédente dans l'historique annuler/rétablir plutôt que créer sa propre
// étape — voir recordHistory() plus bas. Quasiment toutes les mutations du
// CV passent par save() (directement ou via rerender()), ce qui en fait le
// point d'accroche unique de l'historique.
function save(grouped = false) {
  try {
    localStorage.setItem(LS_KEY, JSON.stringify(state));
  } catch {
    /* stockage indisponible : l'édition reste possible dans la page */
  }
  recordHistory(grouped);
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
const jobUrlEl = $('#jobUrl');
const jobUrlStatusEl = $('#jobUrlStatus');
const aiResponseTextEl = $('#aiResponseText');
const aiOnboardingStatusEl = $('#aiOnboardingStatus');
const versionListEl = $('#versionList');
const versionNameEl = $('#versionName');
const overflowNoticeEl = $('#overflowNotice');
const pageCountEl = $('#pageCount');
const photoFileEl = $('#photoFile');

let pendingFocusBulletId = null;

/* ---------- Pré-remplissage par chatbot ---------- */

// Le chatbot n'a besoin ni des identifiants internes, ni des réglages visuels :
// normalizeState() les ajoute au collage avant d'afficher le CV.
// Structure JSON imposée au chatbot, partagée entre le prompt de
// pré-remplissage (CV vide) et le prompt d'adaptation à une offre (CV
// existant) : les deux doivent produire un CV collable tel quel dans
// #aiResponseText.
const AI_CV_JSON_SCHEMA = `{
  "profile": {
    "name": "",
    "title": "",
    "contact": [{ "label": "Email", "value": "" }],
    "summary": "",
    "links": [{ "label": "LinkedIn", "url": "" }]
  },
  "experiences": [{
    "role": "",
    "company": "",
    "period": "",
    "companyDescription": "",
    "bullets": [{ "text": "" }]
  }],
  "education": [{ "title": "", "detail": "", "bullets": [{ "text": "" }] }],
  "projects": [{ "title": "", "detail": "", "bullets": [{ "text": "" }] }],
  "skills": "",
  "skillGroups": [{ "label": "", "text": "" }],
  "interests": [{ "text": "" }]
}`;

const AI_PREFILL_PROMPT = `Je vais te transmettre le contenu d'un ancien CV, d'un profil LinkedIn ou de notes. Transforme uniquement les informations réellement présentes en un CV français, clair et concis.

Réponds uniquement avec un JSON valide, sans markdown, sans texte avant ou après. N'invente aucune expérience, date, diplôme, chiffre, outil ou niveau de langue. Si une information manque, utilise une chaîne vide ou une liste vide.

Respecte exactement cette structure (sans ajouter de clés) :
${AI_CV_JSON_SCHEMA}

Pour les expériences, privilégie des réalisations courtes et précises. Voici mes informations :

[COLLEZ ICI VOTRE ANCIEN CV OU VOS NOTES — OU JOIGNEZ-LES À CE CHAT AU FORMAT PDF OU WORD]`;

// CV actuel (state), réduit à la forme du schéma ci-dessus : pas d'ids, de
// photo, de réglages visuels, de versions ni de proposition — juste la
// matière que le chatbot doit reformuler pour l'offre.
function buildJobCvData() {
  return {
    profile: {
      name: state.profile.name,
      title: state.profile.title,
      contact: state.profile.contact.map((c) => ({ label: c.label, value: c.value })),
      summary: state.profile.summary,
      links: state.profile.links.map((l) => ({ label: l.label, url: l.url })),
    },
    experiences: state.experiences.map((e) => ({
      role: e.role,
      company: e.company,
      period: e.period,
      companyDescription: e.companyDescription,
      bullets: e.bullets.map((b) => ({ text: b.text })),
    })),
    education: state.education.map((e) => ({ title: e.title, detail: e.detail, bullets: e.bullets.map((b) => ({ text: b.text })) })),
    projects: state.projects.map((e) => ({ title: e.title, detail: e.detail, bullets: e.bullets.map((b) => ({ text: b.text })) })),
    skills: state.skills,
    skillGroups: state.skillGroups.map((g) => ({ label: g.label, text: g.text })),
    interests: state.interests.map((it) => ({ text: it.text })),
  };
}

// Prompt envoyé depuis l'extension (offre WTTJ) : contrairement à
// AI_PREFILL_PROMPT (CV vide → à remplir), celui-ci transmet le CV déjà
// rempli et demande de l'adapter à l'offre. La réponse se colle dans le même
// panneau « Partir de votre CV existant » (#aiResponseText).
function buildJobCvPrompt() {
  return [
    "Je vais te transmettre mon CV actuel (au format JSON) et une offre d'emploi. Adapte mon CV à cette offre, en français, clair et concis.",
    '',
    "Réponds uniquement avec un JSON valide, sans markdown, sans texte avant ou après. N'invente aucune expérience, date, diplôme, chiffre, outil ou niveau de langue : reformule, réordonne et sélectionne uniquement à partir des informations présentes dans mon CV. Reprends le vocabulaire de l'offre uniquement quand il décrit vraiment ce que j'ai fait. Si une information manque, utilise une chaîne vide ou une liste vide.",
    '',
    'Respecte exactement cette structure (sans ajouter de clés) :',
    AI_CV_JSON_SCHEMA,
    '',
    'Pour les expériences, privilégie des réalisations courtes et précises. Voici mes informations :',
    '',
    '## Mon CV actuel',
    JSON.stringify(buildJobCvData(), null, 2),
    '',
    "## Offre d'emploi",
    '"""',
    effectiveJobText(),
    '"""',
  ].join('\n');
}

function setAiOnboardingStatus(message, isError = false) {
  aiOnboardingStatusEl.textContent = message;
  aiOnboardingStatusEl.classList.toggle('error', isError);
}

async function copyAiPrompt() {
  try {
    if (!navigator.clipboard || !navigator.clipboard.writeText) throw new Error('clipboard indisponible');
    await navigator.clipboard.writeText(AI_PREFILL_PROMPT);
  } catch {
    // Repli pour les navigateurs qui bloquent l'API Clipboard hors HTTPS.
    const helper = el('textarea', { 'aria-hidden': 'true' });
    helper.value = AI_PREFILL_PROMPT;
    helper.style.cssText = 'position:fixed;left:-9999px;top:0';
    document.body.append(helper);
    helper.select();
    const copied = document.execCommand('copy');
    helper.remove();
    if (!copied) {
      setAiOnboardingStatus('Copie impossible : sélectionnez le prompt dans votre navigateur.', true);
      return;
    }
  }
  setAiOnboardingStatus('Prompt copié. Ajoutez vos informations dans le chatbot.', false);
  $('#copyAiPromptBtn').textContent = 'Prompt copié';
}

function parseAiResponse(text) {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const parsed = JSON.parse((fenced ? fenced[1] : text).trim());
  if (!parsed || typeof parsed !== 'object' || !parsed.profile || !Array.isArray(parsed.experiences)) {
    throw new Error('format');
  }
  return parsed;
}

function applyAiResponse() {
  try {
    const aiData = parseAiResponse(aiResponseTextEl.value);
    // Préserve les versions et les choix visuels déjà présents, et repart sur
    // l'onglet de création pour que le CV pré-rempli soit immédiatement visible.
    // Le chatbot ne renvoie jamais de photo : on garde celle déjà affichée
    // plutôt que de l'effacer.
    const { photo, photoSrc, photoCrop } = state.profile;
    state = normalizeState({ ...state, ...aiData, proposal: null, activeTab: 'create' });
    state.profile.photo = photo;
    state.profile.photoSrc = photoSrc;
    state.profile.photoCrop = photoCrop;
    jobTextEl.value = state.jobText;
    aiResponseTextEl.value = '';
    rerender();
  } catch {
    setAiOnboardingStatus('Réponse non reconnue : collez uniquement le JSON fourni par le chatbot.', true);
  }
}

$('#copyAiPromptBtn').addEventListener('click', copyAiPrompt);
$('#applyAiResponseBtn').addEventListener('click', applyAiResponse);

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
  if (!cvScaleEl) return;
  // Calculé dans les DEUX onglets : le cadre ne se rétrécit sous 210mm que
  // lorsque la place manque (onglet « Nouveau CV », ou fenêtre étroite dans
  // l'onglet « CV de base » — voir le palier 780px de styles.css). Partout
  // ailleurs le rapport vaut 1 et le CV garde sa taille réelle : inutile de
  // distinguer les onglets ici, la largeur mesurée suffit.
  const w = cvScaleEl.getBoundingClientRect().width;
  if (w <= 0) return; // cadre pas encore mis en page (ex. onglet masqué)
  // Sous 1/1000e près, on fige à 1 : appliquer un scale(0.9999) pour rien
  // ferait passer le CV par une couche de composition et rendrait le texte
  // légèrement flou à la taille réelle, cas de loin le plus courant.
  const ratio = w / CV_MM_PX;
  cvScaleEl.style.setProperty('--cv-scale', String(ratio > 0.999 ? 1 : ratio));
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
    // Mesure sur le contenu IMPRIMÉ, pas sur l'écran : un bloc déplié
    // (chip .bullet-more) affiche plus de tirets qu'à l'impression, ce qui
    // fausserait le calcul dans un sens comme dans l'autre. Voir
    // #cv.measuring-print dans styles.css (synchronisée avec @media print).
    cvEl.classList.add('measuring-print');
    const room = cvEl.clientHeight;
    for (const col of cvEl.querySelectorAll('.main, .side')) {
      excess = Math.max(excess, col.scrollHeight - room);
    }
    cvEl.classList.remove('measuring-print');
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
  // Sur le contenu IMPRIMÉ (voir #cv.measuring-print, styles.css) : sinon un
  // bloc déplié à l'écran ferait apparaître un saut de page absent du PDF.
  cvEl.classList.add('measuring-print');
  const tops = kids.map((k) => k.offsetTop);
  const heights = kids.map((k) => k.offsetHeight);
  cvEl.classList.remove('measuring-print');
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

// Réglage de la limite d'affichage d'un bloc (expérience, formation, projet) :
// combien de tirets, dans l'ordre courant, sont montrés à l'écran et à
// l'impression (voir normalizeMaxVisible/bulletsUl). Vide = pas de limite.
function visibleLimitCtl(item) {
  return el(
    'label',
    { class: 'visible-limit-ctl', title: 'Nombre de tirets affichés (vide = tous)' },
    el('span', { class: 'visible-limit-label', text: 'Aff.' }),
    el('input', {
      class: 'visible-limit-input',
      type: 'number',
      min: '0',
      max: String(item.bullets.length),
      placeholder: '∞',
      value: item.maxVisible === null ? '' : String(item.maxVisible),
    })
  );
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
  return fillMultiline(
    el('div', { class: 'cv-summary', contenteditable: 'true', 'data-multiline': '', 'data-bind': 'summary' }),
    state.profile.summary
  );
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

// Champs où Maj+Entrée (les champs multilignes : simplement Entrée) ajoute une
// ligne dans le champ lui-même plutôt que de valider/quitter.
function isLineBreakField(t) {
  return t.hasAttribute('data-multiline') || t.classList.contains('bullet-text');
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
  let out;
  if (!order) {
    out = exp.bullets;
  } else {
    const byId = new Map(exp.bullets.map((b) => [b.id, b]));
    out = [];
    for (const id of order) {
      const b = byId.get(id);
      if (b) {
        out.push(b);
        byId.delete(id);
      }
    }
    out.push(...byId.values());
  }
  return out;
}

// Tirets réellement imprimés d'un bloc (expérience, formation, projet) :
// l'ordre affiché, tronqué à maxVisible. Pas de coupe si maxVisible est
// `null` ou couvre déjà tous les tirets — voir normalizeMaxVisible/bulletsUl.
// Utilisé partout où le rendu doit ignorer les tirets repliés (PDF client,
// couverture de mots-clés, mesures de pagination).
function visibleBullets(item) {
  const bullets = displayBullets(item);
  if (typeof item.maxVisible !== 'number' || item.maxVisible >= bullets.length) return bullets;
  return bullets.slice(0, item.maxVisible);
}

// Badge de diff d'un tiret de la proposition : compare sa position affichée à
// sa position dans le CV de base. Rendu uniquement au survol du CV (voir
// styles.css) et jamais dans le PDF.
function diffBadge(bulletId, index, ownerId) {
  if (!ownerId || !inCreateTab() || !proposalOrderFor(ownerId)) return null;
  const owner = findOwnerById(ownerId);
  const baseIdx = owner ? owner.bullets.findIndex((b) => b.id === bulletId) : -1;
  if (baseIdx === -1 || baseIdx === index) return null;
  const arrow = baseIdx > index ? '↑' : '↓';
  return el('span', {
    class: 'diff-badge',
    title: 'Position dans le CV de base',
    text: `${arrow} était n°${baseIdx + 1}`,
  });
}

// Modèle de l'offre pour le rendu du CV en cours, reconstruit une seule fois
// par appel à renderCV() (voir plus bas) plutôt qu'une fois par tiret : le
// panneau de suggestions rebâtit le sien séparément, mais ce cache-ci évite
// de retokeniser l'offre pour chaque tiret de chaque expérience.
let renderJobModel = null;

// Badge listant les mots-clés de l'offre trouvés dans un tiret (expérience,
// formation ou projet — ownerId n'est fourni que si le tiret appartient à un
// propriétaire, voir bulletsUl). Élément SÉPARÉ du .bullet-text (jamais dans
// son innerHTML) pour ne jamais corrompre le texte édité par l'utilisateur.
// Comme diffBadge : uniquement au survol (voir styles.css), jamais dans le PDF.
function matchBadge(text, ownerId) {
  if (!ownerId || !renderJobModel) return null;
  const { matched } = scoreBullet(text, renderJobModel);
  if (!matched.length) return null;
  const shown = matched.slice(0, 4);
  const extra = matched.length - shown.length;
  return el('span', {
    class: 'match-badge',
    title: 'Mots-clés de l’offre trouvés dans ce tiret',
    text: shown.join(', ') + (extra > 0 ? ` +${extra}` : ''),
  });
}

// Ids des blocs (expérience/formation/projet) dont la coupe d'affichage est
// dépliée à l'écran — purement éphémère : jamais persisté, jamais dans
// `state`, donc toujours replié après un rechargement de la page.
const expandedCutIds = new Set();

// Liste de points réordonnable, partagée par les expériences, la formation
// et les projets (l'identité du propriétaire se retrouve via ownerFromSection,
// pas via un attribut sur le <ul> lui-même). `ownerId` sert au diff avec le
// CV de base (et aux mots-clés matchés) pendant une proposition. `maxVisible`
// coupe l'affichage après les N premiers points dans l'ordre courant ; les
// points au-delà restent enregistrés (voir normalizeMaxVisible) et sont
// seulement masqués — révélables via le chip « + N » en fin de liste.
function bulletsUl(bullets, ownerId, maxVisible) {
  // maxVisible peut dépasser bullets.length en cours de session (points
  // supprimés depuis le réglage de la limite) : au-delà, pas de coupe.
  const cut = typeof maxVisible === 'number' && maxVisible < bullets.length ? maxVisible : null;
  const expanded = cut !== null && expandedCutIds.has(ownerId);
  const ul = el('ul', { class: 'bullets' + (expanded ? ' expanded-cut' : '') });
  bullets.forEach((b, j) => {
    const badge = diffBadge(b.id, j, ownerId);
    const belowCut = cut !== null && j >= cut;
    ul.append(
      el(
        'li',
        { class: 'bullet' + (badge ? ' moved' : '') + (belowCut ? ' below-cut' : ''), 'data-bullet-id': b.id },
        el('span', { class: 'drag-handle', title: 'Glisser pour réordonner', text: '⠿' }),
        el('span', { class: 'bullet-dot', text: '•' }),
        fillMultiline(
          el('div', { class: 'bullet-text', contenteditable: 'true', 'data-bullet-id': b.id }),
          b.text
        ),
        badge && el('span', { class: 'bullet-badges' }, badge),
        matchBadge(b.text, ownerId),
        el(
          'div',
          { class: 'bullet-controls' },
          j > 0 && iconBtn('↑', 'bullet-up', 'Monter le point'),
          j < bullets.length - 1 && iconBtn('↓', 'bullet-down', 'Descendre le point'),
          iconBtn('✕', 'bullet-del', 'Supprimer le point', 'del')
        )
      )
    );
  });
  if (cut !== null) {
    const hidden = bullets.length - cut;
    ul.append(
      el('button', {
        class: 'bullet-more',
        type: 'button',
        'data-action': 'bullet-more',
        text: expanded ? 'Masquer' : `+ ${hidden} point${hidden > 1 ? 's' : ''} masqué${hidden > 1 ? 's' : ''}`,
      })
    );
  }
  return ul;
}

function experiencesBlock() {
  // Enveloppe (titre + expériences + bouton d'ajout) dans un conteneur : c'est
  // lui, et non tout le CV, qui déclenche l'apparition du « + Ajouter une
  // expérience » au survol (voir la règle de scoping par section dans styles.css).
  const frag = el('section', { class: 'cv-block' });
  frag.append(sectionTitle('Expériences professionnelles'));
  state.experiences.forEach((exp, i) => {
    // Rangée unique en bas du bloc : « + Ajouter un tiret » à gauche, puis à
    // droite le réglage de limite et les icônes ↑ ↓ ✕ (voir « Limite
    // d'affichage » dans styles.css — c'est là que vivent désormais toutes
    // les affordances du bloc, plus aucune ne recouvre le titre ou la période).
    const footer = el(
      'div',
      { class: 'exp-footer' },
      el('button', { class: 'add-bullet', type: 'button', 'data-action': 'bullet-add', text: '+ Ajouter un tiret' }),
      el(
        'div',
        { class: 'exp-footer-right' },
        visibleLimitCtl(exp),
        exp.maxVisible === 0 && el('span', { class: 'limit-zero-note', text: 'non imprimé' }),
        el(
          'div',
          { class: 'exp-controls' },
          i > 0 && iconBtn('↑', 'exp-up', 'Monter l’expérience'),
          i < state.experiences.length - 1 && iconBtn('↓', 'exp-down', 'Descendre l’expérience'),
          iconBtn('✕', 'exp-del', 'Supprimer l’expérience', 'del')
        )
      )
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

    const companyDesc = fillMultiline(
      el('div', { class: 'exp-company-desc', contenteditable: 'true', 'data-multiline': '', 'data-field': 'companyDescription' }),
      exp.companyDescription
    );

    frag.append(
      el(
        'section',
        { class: 'exp' + (exp.maxVisible === 0 ? ' limit-zero' : ''), 'data-exp-id': exp.id },
        head,
        companyDesc,
        bulletsUl(displayBullets(exp), exp.id, exp.maxVisible),
        footer
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
    // Même rangée unique qu'une expérience (voir experiencesBlock) : « +
    // Ajouter un point » à gauche, réglage de limite et ✕ à droite.
    const footer = el(
      'div',
      { class: 'exp-footer' },
      el('button', { class: 'add-bullet', type: 'button', 'data-action': 'bullet-add', text: '+ Ajouter un point' }),
      el(
        'div',
        { class: 'exp-footer-right' },
        visibleLimitCtl(it),
        it.maxVisible === 0 && el('span', { class: 'limit-zero-note', text: 'non imprimé' }),
        el('div', { class: 'exp-controls' }, iconBtn('✕', `${kind}-del`, 'Supprimer', 'del'))
      )
    );

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
        { class: 'exp' + (it.maxVisible === 0 ? ' limit-zero' : ''), [`data-${kind}-id`]: it.id },
        head,
        bulletsUl(displayBullets(it), it.id, it.maxVisible),
        footer
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
  // Modèle de l'offre construit UNE fois pour tout le rendu (voir matchBadge),
  // pas une fois par tiret : la tokenisation de l'offre est le coût évité.
  const jobText = inCreateTab() ? effectiveJobText() : '';
  const model = jobText ? buildJobModel(jobText) : null;
  renderJobModel = model && !model.empty ? model : null;
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
  // Appelé aussi bien pour un clic sur une pastille (ponctuel) que pendant un
  // glissement dans le sélecteur libre (continu) : regrouper est correct dans
  // les deux cas (voir recordHistory), l'étape se clôt d'elle-même en moins
  // d'1 s ou à la première action suivante.
  save(true);
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
  save(true); // sélecteur de couleur natif : peut défiler en continu
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

/* ============================================================
   Historique global (Annuler / Rétablir)
   ============================================================
   Une pile unique d'instantanés du CV (snapshotCV()) couvre TOUTE
   modification : texte édité, ajout/suppression de section/tiret, glisser-
   déposer, photo, lien, modèle, couleurs, tailles de texte, réinitialiser,
   import JSON, remplissage par l'IA, chargement d'un CV sauvegardé... Comme
   quasiment toutes ces mutations passent par save() (directement ou via
   rerender()), c'est là qu'on accroche l'historique plutôt que de dupliquer
   la logique à chaque point d'appel.

   Une frappe continue dans un champ (ou un glissement de curseur) ne doit
   compter que pour UNE étape : `historyPending` mémorise l'instantané
   d'AVANT le début de l'interaction ; `lastSnapshot` suit l'état courant à
   chaque save() « groupé ». L'étape n'est réellement empilée qu'à sa clôture
   (blur du champ, ~1 s d'inactivité, ou toute action qui suit). */

const HISTORY_MAX = 100;
const undoStack = [];
const redoStack = [];
let lastSnapshot = snapshotCV(); // dernier instantané reflété par undo/redoStack
let historyPending = null; // instantané d'avant l'interaction continue en cours, ou null
let historyTypingTimer = null;

function refreshHistoryButtons() {
  $('#undoBtn').disabled = undoStack.length === 0 && !historyPending;
  $('#redoBtn').disabled = redoStack.length === 0;
}

// Clôt l'interaction continue en cours (frappe, glissement) : empile
// l'instantané capturé à son début, sauf si rien n'a finalement changé.
// Ne touche pas `lastSnapshot` : les save() « groupés » l'ont déjà tenu à
// jour tout du long, il n'y a rien à en déduire ici.
function commitHistoryStep() {
  clearTimeout(historyTypingTimer);
  historyTypingTimer = null;
  if (!historyPending) return;
  const prev = historyPending;
  historyPending = null;
  if (JSON.stringify(prev) !== JSON.stringify(lastSnapshot)) {
    undoStack.push(prev);
    if (undoStack.length > HISTORY_MAX) undoStack.shift();
  }
  refreshHistoryButtons();
}

// Appelé par save() à chaque mutation du CV.
function recordHistory(grouped) {
  const current = snapshotCV();
  if (grouped) {
    if (JSON.stringify(current) === JSON.stringify(lastSnapshot)) return; // rien n'a changé
    if (!historyPending) historyPending = lastSnapshot;
    lastSnapshot = current;
    redoStack.length = 0;
    clearTimeout(historyTypingTimer);
    historyTypingTimer = setTimeout(commitHistoryStep, 1000);
    refreshHistoryButtons();
    return;
  }
  // Mutation ponctuelle (bouton, sélection, glisser-déposer…) : clôt d'abord
  // une éventuelle interaction continue en cours comme étape séparée, puis
  // empile l'état d'avant CETTE mutation-ci si le CV a changé.
  commitHistoryStep();
  if (JSON.stringify(current) === JSON.stringify(lastSnapshot)) return;
  undoStack.push(lastSnapshot);
  if (undoStack.length > HISTORY_MAX) undoStack.shift();
  redoStack.length = 0;
  lastSnapshot = current;
  refreshHistoryButtons();
}

// Referme l'interaction continue en cours dès que le focus quitte un champ
// (contenteditable du CV, curseur de taille, sélecteur de couleur…), sans
// attendre le délai d'inactivité. Sans effet s'il n'y a rien en attente.
document.addEventListener('focusout', () => commitHistoryStep());

// Restaure un instantané (annuler/rétablir) : remet `state` à jour, comme au
// chargement d'un CV sauvegardé, puis re-rend. `lastSnapshot` est aligné
// AVANT rerender()/save() pour que ce save() ne réempile rien.
function restoreCV(entry) {
  applyCV(entry);
  lastSnapshot = snapshotCV();
  refreshHistoryButtons();
  rerender();
}

function undo() {
  // Une frappe/un glissement en cours devient sa propre étape, qu'on annule
  // ensuite : Cmd+Z pendant la saisie retire alors tout ce qui vient d'être
  // tapé d'un coup, comme si l'étape avait déjà été close.
  commitHistoryStep();
  const entry = undoStack.pop();
  if (!entry) return false;
  redoStack.push(lastSnapshot);
  if (redoStack.length > HISTORY_MAX) redoStack.shift();
  restoreCV(entry);
  return true;
}

function redo() {
  const entry = redoStack.pop();
  if (!entry) return false;
  undoStack.push(lastSnapshot);
  if (undoStack.length > HISTORY_MAX) undoStack.shift();
  restoreCV(entry);
  return true;
}

// N'intercepte le raccourci que s'il y a effectivement quelque chose à
// annuler/rétablir : sinon l'évènement suit son cours normalement (undo
// natif du navigateur dans un champ texte, par exemple).
document.addEventListener('keydown', (e) => {
  if (!(e.metaKey || e.ctrlKey)) return;
  const k = e.key.toLowerCase();
  if (k === 'z' && !e.shiftKey) {
    if ((undoStack.length || historyPending) && undo()) e.preventDefault();
  } else if ((k === 'z' && e.shiftKey) || k === 'y') {
    if (redoStack.length && redo()) e.preventDefault();
  }
});

$('#undoBtn').addEventListener('click', () => undo());
$('#redoBtn').addEventListener('click', () => redo());
refreshHistoryButtons();

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
  const val = window.cvClampFontSize(inp.value, role.def);
  state.fontSizes[tpl][inp.dataset.zone][role.key] = val;
  syncFontRow(inp, val);
  applyFontSizes();
  save(true); // glissement/frappe en cours : une seule étape d'historique
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
  save(); // clôt l'interaction en cours (voir recordHistory)
});

$('#fontResetBtn').addEventListener('click', () => {
  // Seul le modèle affiché est remis à zéro : l'autre garde ses réglages.
  const tpl = fontTemplate();
  state.fontSizes[tpl] = normalizeFontSizes(null)[tpl];
  applyFontSizes();
  renderFontControls();
  save();
});

/* ---------- Recherche dans l'état ---------- */

function findExp(id) {
  return state.experiences.find((e) => e.id === id);
}

// Retrouve un propriétaire de tirets (expérience, formation ou projet) par
// son id, quelle que soit sa liste — les trois partagent la même structure
// (titre, détail éventuel, liste de points).
function findOwnerById(id) {
  return state.experiences.find((e) => e.id === id) || state.education.find((e) => e.id === id) || state.projects.find((e) => e.id === id);
}

// Retrouve l'expérience/formation/projet propriétaire d'un <section class="exp">,
// quel que soit son type — les trois partagent la même structure (titre, détail
// éventuel, liste de points).
function ownerFromSection(section) {
  if (!section) return null;
  const id = section.dataset.expId || section.dataset.eduId || section.dataset.projectId;
  return id ? findOwnerById(id) : null;
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
  renderCV();
  renderSuggestions();
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
  const text = isLineBreakField(t) ? t.innerText.replace(/\n$/, '') : t.textContent;

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
    const bulletId = t.dataset.bulletId;
    const owner = ownerFromSection(section);
    const b = owner && owner.bullets.find((x) => x.id === bulletId);
    if (b) b.text = text;
    scheduleSuggestions();
  } else if (t.dataset.field) {
    const owner = ownerFromSection(t.closest('section.exp'));
    if (owner) owner[t.dataset.field] = text;
    scheduleSuggestions();
  }
  save(true); // frappe en cours : une seule étape d'historique, close au blur
});

// Coller en texte brut uniquement
cvEl.addEventListener('paste', (e) => {
  const t = e.target.closest('[contenteditable]');
  if (!t) return;
  e.preventDefault();
  // Un champ multiligne garde les retours à la ligne du presse-papiers.
  const raw = e.clipboardData.getData('text/plain');
  const text = isLineBreakField(t)
    ? raw.replace(/\r\n?/g, '\n').replace(/[^\S\n]+/g, ' ')
    : raw.replace(/\s+/g, ' ');
  document.execCommand('insertText', false, text);
});

// Entrée dans un tiret = nouveau tiret (Maj+Entrée : saut de ligne dans le
// tiret courant) ; ailleurs, pas de saut de ligne.
cvEl.addEventListener('keydown', (e) => {
  if (e.key !== 'Enter') return;
  const t = e.target.closest('[contenteditable]');
  if (!t) return;
  e.preventDefault();
  if (t.hasAttribute('data-multiline') || (e.shiftKey && t.classList.contains('bullet-text'))) {
    // Champ multiligne (ou Maj+Entrée dans un tiret) : Entrée ajoute une
    // ligne dans le champ lui-même.
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
    proposalInsert(owner.id, nb.id, idx === -1 ? null : t.dataset.bulletId);
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
      proposalInsert(owner.id, nb.id);
      pendingFocusBulletId = nb.id;
      break;
    }
    case 'bullet-del': {
      if (!owner || !li) return;
      owner.bullets = owner.bullets.filter((b) => b.id !== li.dataset.bulletId);
      proposalRemove(owner.id, li.dataset.bulletId);
      break;
    }
    case 'bullet-more': {
      if (!owner) return;
      if (expandedCutIds.has(owner.id)) expandedCutIds.delete(owner.id);
      else expandedCutIds.add(owner.id);
      break;
    }
    case 'bullet-up':
    case 'bullet-down': {
      if (!owner || !li) return;
      // Dans l'onglet « Nouveau CV » pendant une proposition, les flèches
      // réordonnent la proposition ; sinon, le CV de base.
      const ord = inCreateTab() ? proposalOrderFor(owner.id) : null;
      const arr = ord || owner.bullets;
      const idx = ord ? ord.indexOf(li.dataset.bulletId) : owner.bullets.findIndex((b) => b.id === li.dataset.bulletId);
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
        maxVisible: null,
      });
      break;
    }
    case 'exp-del': {
      if (!exp) return;
      if (!(await customConfirm('Supprimer cette expérience et tous ses tirets ?', { confirmLabel: 'Supprimer', danger: true }))) return;
      state.experiences = state.experiences.filter((x) => x.id !== exp.id);
      if (state.proposal) delete state.proposal.orders[exp.id];
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
      state.education.push({ id: uid(), title: 'Diplôme', detail: 'Établissement (année)', bullets: [], maxVisible: null });
      break;
    }
    case 'edu-del': {
      if (!expSection) return;
      if (!(await customConfirm('Supprimer cette formation et tous ses points ?', { confirmLabel: 'Supprimer', danger: true }))) return;
      state.education = state.education.filter((x) => x.id !== expSection.dataset.eduId);
      if (state.proposal) delete state.proposal.orders[expSection.dataset.eduId];
      break;
    }
    case 'project-add': {
      state.projects.push({ id: uid(), title: 'Projet', detail: 'technologies, résultat (année)', bullets: [], maxVisible: null });
      break;
    }
    case 'project-del': {
      if (!expSection) return;
      if (!(await customConfirm('Supprimer ce projet et tous ses points ?', { confirmLabel: 'Supprimer', danger: true }))) return;
      state.projects = state.projects.filter((x) => x.id !== expSection.dataset.projectId);
      if (state.proposal) delete state.proposal.orders[expSection.dataset.projectId];
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

// Réglage de la limite d'affichage (champ numérique de .exp-footer) : pas
// de conflit avec le listener `input` ci-dessus, qui ne traite que les
// [contenteditable] (le champ number n'en est pas un).
cvEl.addEventListener('change', (e) => {
  const input = e.target.closest('.visible-limit-input');
  if (!input) return;
  const owner = ownerFromSection(input.closest('section.exp'));
  if (!owner) return;
  const raw = input.value.trim();
  owner.maxVisible = raw === '' ? null : normalizeMaxVisible(Number(raw), owner.bullets.length);
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
const confirmExtraBtnEl = $('#confirmExtraBtn');
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
// `extraLabel` : 3ᵉ bouton optionnel (ex. « Ne pas sauvegarder ») entre Annuler
// et le bouton principal ; résout la promesse avec la chaîne 'extra'.
function customConfirm(message, { confirmLabel = 'Confirmer', danger = false, extraLabel = null } = {}) {
  return new Promise((resolve) => {
    resolveConfirm = resolve;
    confirmModalMessageEl.textContent = message;
    confirmOkBtnEl.textContent = confirmLabel;
    confirmOkBtnEl.classList.toggle('danger', danger);
    confirmExtraBtnEl.hidden = !extraLabel;
    if (extraLabel) confirmExtraBtnEl.textContent = extraLabel;
    // Avec un 3ᵉ bouton, c'est lui qui abandonne les modifications : il prend
    // le rouge doux habituellement porté par « Annuler », qui redevient un
    // simple bouton bleu neutre (rien de destructif à annuler dans ce cas).
    confirmCancelBtnEl.classList.toggle('cancel', !extraLabel);
    confirmCancelBtnEl.classList.toggle('ghost', !!extraLabel);
    confirmExtraBtnEl.classList.toggle('cancel', !!extraLabel);
    confirmModalEl.hidden = false;
    confirmOkBtnEl.focus();
  });
}

confirmOkBtnEl.addEventListener('click', () => closeConfirmModal(true));
confirmExtraBtnEl.addEventListener('click', () => closeConfirmModal('extra'));
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
    const ord = inCreateTab() ? proposalOrderFor(owner.id) : null;
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

// Enregistre le CV actuellement affiché : écrase la version active si une
// version est chargée, sinon crée une nouvelle version (mêmes règles de nom
// par défaut que le bouton « Enregistrer »). Utilisé par la pop-up de
// confirmation avant de charger une autre version (« Sauvegarder et charger »).
function saveCurrentCvAsVersion() {
  const active = state.activeVersionId && state.versions.find((v) => v.id === state.activeVersionId);
  if (active) {
    active.data = snapshotCV();
    active.createdAt = Date.now();
  } else {
    const name = `Version du ${new Date().toLocaleDateString('fr-FR')} à ${new Date().toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })}`;
    const v = { id: uid(), name, createdAt: Date.now(), data: snapshotCV() };
    state.versions.unshift(v);
    state.activeVersionId = v.id;
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
      if (!isCurrentCvSaved()) {
        const choice = await customConfirm(
          `Charger « ${v.name} » comme CV de base ? Le CV de base actuel a des modifications non enregistrées.`,
          { confirmLabel: 'Sauvegarder et charger', extraLabel: 'Ne pas sauvegarder' }
        );
        if (choice === false) return;
        if (choice === true) saveCurrentCvAsVersion();
        // choice === 'extra' : on charge sans rien sauvegarder, les
        // modifications en cours sont perdues.
      }
      applyCV(v.data);
      // La proposition référençait l'ancien CV : plus de sens.
      state.proposal = null;
      state.activeVersionId = v.id;
      rerender();
      break;
    }
    case 'overwrite': {
      // Pas de confirmation quand on est déjà sur cette version : on
      // enregistre simplement les modifications en cours dans celle-ci.
      if (v.id !== state.activeVersionId && !(await customConfirm(
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
    'scale up scaleup startup licorne filiale groupe leader acteur pionnier ' +
    // Verbes d'action passe-partout : listés comme « absents du CV », ils
    // conseilleraient d'ajouter « améliorer » à ses compétences.
    'reduire ameliorer piloter gerer assurer participer contribuer developper accompagner ' +
    // Titres de rubrique d'une annonce : structurent l'offre, ne décrivent
    // aucune compétence — listés comme « absents », ils n'aident en rien.
    'responsabilites responsabilite taches activites description contexte avantages ' +
    'remuneration salaire processus recrutement rejoignez postuler localisation ' +
    'garantir favoriser optimiser realiser mener definir suivre animer proposer ' +
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

// Construit la proposition : l'ordre suggéré par l'analyse, par expérience,
// formation et projet. Le CV de base n'est PAS modifié — la proposition
// n'est qu'une surcouche d'ordre, affichée dans l'onglet « Nouveau CV ».
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
  for (const owner of [...state.experiences, ...state.education, ...state.projects]) {
    const suggested = suggestOrder(owner, model).scored.map((s) => s.bullet.id);
    orders[owner.id] = suggested;
    if (suggested.some((id, i) => owner.bullets[i].id !== id)) changed = true;
  }
  state.proposal = changed ? { orders } : null;
}

// Nom proposé pour le CV enregistré : dérivé de l'offre analysée
// ("Entreprise — Poste"), pour repérer un CV dans la liste sans le rouvrir.
// Repli sur la date si l'offre est vide ou n'a rien d'exploitable.
function defaultVersionName() {
  const fallback = `Offre du ${new Date().toLocaleDateString('fr-FR')}`;
  const lines = effectiveJobText().split('\n').map((l) => l.trim()).filter(Boolean);
  if (!lines.length) return fallback;

  const title = extractJobTitle(lines[0]);
  const company = extractCompanyName(lines.slice(0, 10));
  const name = company && title ? `${company} — ${title}` : title || fallback;
  return name.length > 60 ? name.slice(0, 60).trim() : name;
}

// Titre de poste : première ligne de l'offre, débarrassée des mentions de
// genre (H/F, F/H...) puis coupée au premier séparateur (tiret, virgule...)
// car ce qui suit est en général la localisation ou l'équipe, pas le titre.
function extractJobTitle(firstLine) {
  let title = firstLine
    .replace(/[\s(]*[hHfFmM]\s*\/\s*[hHfFmM][\s)]*/g, ' ')
    .trim()
    .replace(/[\s\-–—:,.]+$/, '');
  const sep = title.match(/ — | - |,|\/|\|/);
  if (sep) {
    title = title.slice(0, sep.index).trim();
  } else if (title.length > 60) {
    title = title.slice(0, 60).trim();
  }
  return title;
}

// Entreprise : cherche une ligne "Entreprise :" / "Société :" / "Company:",
// sinon un motif "chez X" / "@ X" dans le début de l'offre.
function extractCompanyName(lines) {
  const labelRe = /^(?:entreprise|soci[ée]t[ée]|company)\s*:\s*(.+)$/i;
  for (const line of lines) {
    const m = line.match(labelRe);
    if (m) return m[1].split(/[,.]/)[0].trim();
  }
  // « chez » seul est insensible à la casse : une offre commence souvent par
  // « Chez X, nous... ». Le nom, lui, reste exigé en capitale — c'est ce qui
  // le distingue d'un mot ordinaire qui suivrait « chez ».
  const inlineRe = /\b(?:[Cc]hez|@)\s+([A-Z][\w&.\-]*(?:\s+[A-Z][\w&.\-]*){0,3})/;
  for (const line of lines) {
    const m = line.match(inlineRe);
    if (m) return m[1].split(/[,.]/)[0].trim();
  }
  return '';
}

// Réordonne les tirets de chaque élément de `list` selon la proposition en
// cours (no-op sans proposition pour cet élément). Partagé par les trois
// listes (expériences, formations, projets) lors de l'enregistrement.
function applyProposalOrder(list) {
  for (const owner of list) {
    const ord = proposalOrderFor(owner.id);
    if (ord) {
      const byId = new Map(owner.bullets.map((b) => [b.id, b]));
      const out = [];
      for (const id of ord) {
        const b = byId.get(id);
        if (b) {
          out.push(b);
          byId.delete(id);
        }
      }
      owner.bullets = [...out, ...byId.values()];
    }
  }
}

// Le CV de base, avec les tirets de chaque expérience/formation/projet dans
// l'ordre proposé : c'est ce qui est enregistré comme nouveau CV.
function snapshotProposalCV() {
  const snap = snapshotCV();
  applyProposalOrder(snap.experiences);
  applyProposalOrder(snap.education);
  applyProposalOrder(snap.projects);
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

// Tout le texte du CV affiché (hors métadonnées de mise en forme), pour
// savoir quels mots-clés de l'offre y figurent déjà. Réutilisé par la
// couverture de l'offre ci-dessous, jamais affiché tel quel.
// Ne compte que ce qui sera réellement imprimé : un bloc à maxVisible === 0
// est ignoré (son titre/détail comme ses tirets), et les autres blocs
// n'apportent que leurs tirets visibleBullets(item) — sinon un mot-clé
// « couvert » uniquement par un tiret replié donnerait un faux sentiment de
// couverture (le mot n'apparaîtrait pas dans le CV exporté).
function cvFullText() {
  const parts = [state.profile.title, state.profile.summary, state.skills];
  for (const exp of state.experiences) {
    if (exp.maxVisible === 0) continue;
    parts.push(exp.role, exp.company);
    for (const b of visibleBullets(exp)) parts.push(b.text);
  }
  for (const sub of [...state.education, ...state.projects]) {
    if (sub.maxVisible === 0) continue;
    parts.push(sub.title, sub.detail);
    for (const b of visibleBullets(sub)) parts.push(b.text);
  }
  for (const g of state.skillGroups) parts.push(g.label, g.text);
  for (const it of state.interests) parts.push(it.text);
  return parts.filter(Boolean).join(' ');
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
  // Le nom de l'employeur ressort comme mot-clé (il est répété dans l'offre)
  // alors qu'il n'a rien à faire dans un CV : on l'écarte, sinon la liste des
  // mots-clés « absents » conseille d'ajouter « Swan » à ses compétences.
  const employer = new Set(tokenize(extractCompanyName(jobText.split('\n').slice(0, 10))));
  const top = topKeywords(model, 12 + employer.size).filter((w) => !employer.has(w)).slice(0, 12);
  top.forEach((w) => kwBox.append(el('span', { class: 'chip', text: w })));
  resultsEl.append(kwBox);

  // Couverture de l'offre par le CV actuel : réordonner les tirets ne fait
  // apparaître aucune compétence manquante, d'où cet encadré séparé qui
  // pointe ce qu'il faudrait plutôt AJOUTER au CV.
  const cvTokens = new Set(tokenize(cvFullText()));
  const missing = top.filter((w) => !cvTokens.has(w));
  const coverageBox = el(
    'div',
    { class: 'coverage-box' },
    el('div', { class: 'label', text: `Votre CV couvre ${top.length - missing.length} des ${top.length} mots-clés de l’offre` })
  );
  if (missing.length) {
    coverageBox.append(el('div', { class: 'coverage-hint', text: 'Absents de votre CV :' }));
    missing.forEach((w) => coverageBox.append(el('span', { class: 'chip missing', text: w })));
  } else {
    coverageBox.append(el('p', { class: 'apply-note', text: 'Tous les mots-clés principaux de l’offre figurent déjà dans votre CV ✓' }));
  }
  resultsEl.append(coverageBox);

  if (state.proposal) {
    const box = el(
      'div',
      { class: 'proposal-box' },
      el('h3', { text: 'Nouveau CV proposé' }),
      el('p', {
        class: 'hint',
        text: 'Le CV ci-dessous est réordonné pour cette offre — le CV de base n’est pas modifié. ' +
          'Survolez le CV pour voir les tirets déplacés (badge « était n°X »), ' +
          'puis enregistrez ce nouveau CV pour le retrouver dans l’onglet « CV de base ». ' +
          'Ré-analyser l’offre reconstruit la proposition.',
      })
    );
    for (const owner of [...state.experiences, ...state.education, ...state.projects]) {
      if (!proposalOrderFor(owner.id)) continue;
      let moved = 0;
      displayBullets(owner).forEach((b, i) => {
        if (!owner.bullets[i] || owner.bullets[i].id !== b.id) moved += 1;
      });
      box.append(
        el(
          'div',
          { class: 'proposal-exp-line' },
          el('strong', { text: owner.role || owner.title || 'Élément' }),
          ` : ${moved ? `${moved} tiret${moved > 1 ? 's' : ''} déplacé${moved > 1 ? 's' : ''}` : 'ordre inchangé'}`
        )
      );
    }
    // Barre collée en bas du panneau (voir styles.css) : regroupe l'action
    // principale (enregistrer) et l'action secondaire (ignorer) pour qu'elles
    // défilent ensemble, sans jamais se chevaucher.
    box.append(
      el(
        'div',
        { class: 'proposal-save' },
        el(
          'div',
          { class: 'proposal-save-row' },
          el('input', {
            id: 'newCvName',
            type: 'text',
            placeholder: 'Nom du nouveau CV',
            value: newCvNameDraft || defaultVersionName(),
            'aria-label': 'Nom du nouveau CV',
          }),
          el('button', { type: 'button', id: 'saveProposalBtn', text: 'Enregistrer ce nouveau CV' })
        ),
        el('button', { type: 'button', id: 'discardProposalBtn', class: 'link-btn', text: 'Ignorer la proposition' })
      )
    );
    if (proposalSaved) {
      box.append(el('p', { class: 'apply-note', text: 'Nouveau CV enregistré ✓ — retrouvez-le dans l’onglet « CV de base ».' }));
    }
    resultsEl.append(box);
  } else {
    const upToDate = [...state.experiences, ...state.education, ...state.projects].every(
      (owner) => suggestOrder(owner, model).alreadyApplied
    );
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
    clearTimeout(analysisHighlightTimer);
    cvEl.classList.remove('just-analyzed');
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

// Minuteur de la mise en avant post-analyse (animation + badges visibles
// sans survol) : voir styles.css (.just-analyzed). Annulé/relancé à chaque
// nouvelle analyse pour ne jamais empiler plusieurs retraits différés.
let analysisHighlightTimer = null;

// Analyse partagée entre le clic sur « Analyser l'offre » et la récupération
// automatique du texte via une URL (voir fetchJobBtn plus bas) : la mise en
// avant doit jouer dans les deux cas, l'offre récupérée par lien méritant le
// même repère visuel que celle collée à la main.
function runAnalysis() {
  state.jobText = jobTextEl.value;
  buildProposal();
  rerender();
  clearTimeout(analysisHighlightTimer);
  if (state.proposal) {
    cvEl.classList.remove('just-analyzed');
    // Force un reflow pour que l'animation rejoue même si la classe était
    // déjà présente (analyses successives rapprochées).
    void cvEl.offsetWidth;
    cvEl.classList.add('just-analyzed');
    analysisHighlightTimer = setTimeout(() => cvEl.classList.remove('just-analyzed'), 5000);
  }
}

$('#analyzeBtn').addEventListener('click', runAnalysis);

$('#clearAnalysisBtn').addEventListener('click', async () => {
  if (state.proposal && !(await customConfirm(
    'Effacer l’offre et la proposition en cours ? Le CV de base n’est pas affecté, et les CV enregistrés sont conservés.',
    { confirmLabel: 'Effacer' }
  ))) return;
  state.proposal = null;
  proposalSaved = false;
  newCvNameDraft = '';
  jobTextEl.value = '';
  state.jobText = '';
  clearTimeout(analysisHighlightTimer);
  cvEl.classList.remove('just-analyzed');
  rerender();
});

jobTextEl.addEventListener('input', () => {
  // L'analyse ne se relance qu'au clic sur « Analyser », mais on mémorise la saisie
  state.jobText = jobTextEl.value;
  save(true); // frappe en cours : une seule étape d'historique, close au blur
});

/* ---------- Récupération de l'offre depuis une URL ----------
   Le geste naturel est de coller le lien de l'offre (LinkedIn, WTTJ...)
   plutôt que de recopier le texte à la main. server.js expose /fetch-job
   pour contourner le CORS (le navigateur ne peut pas lire ces pages en
   direct) ; ce module transforme le HTML brut renvoyé en texte exploitable,
   puis relance l'analyse existante — sans jamais injecter ce HTML tiers dans
   le document (DOMParser produit un document inerte, jamais affiché). */

// Même repli file:// que PDF_ENDPOINT ci-dessus : le backend écoute sur un
// port fixe hors serveur statique.
const FETCH_JOB_ENDPOINT = location.protocol === 'file:' ? 'http://localhost:3333/fetch-job' : '/fetch-job';

function setJobUrlStatus(message, isError = false) {
  jobUrlStatusEl.textContent = message;
  jobUrlStatusEl.classList.toggle('error', isError);
}

// Supprime les balises HTML d'un fragment (ex. le champ « description » du
// JSON-LD, qui est lui-même du HTML) pour n'en garder que le texte.
// textContent colle bout à bout le contenu des blocs : la fin d'un <li> se
// retrouve soudée au début du suivant (« ...discovery continueIndicateurs... »),
// ce qui fabrique un faux mot-clé ET détruit les deux vrais. Or les exigences
// d'une offre sont presque toujours dans une liste : sans ces sauts de ligne,
// l'analyse perd justement les mots-clés les plus utiles.
function insertBlockBreaks(root) {
  root.querySelectorAll('br').forEach((n) => n.replaceWith('\n'));
  root.querySelectorAll('p, div, li, tr, h1, h2, h3, h4, h5, h6').forEach((n) => n.append('\n'));
}

// Normalise un texte extrait du HTML : une ligne non vide par bloc.
function tidyExtractedText(text) {
  return (text || '')
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean)
    .join('\n')
    .replace(/[ \t]{2,}/g, ' ')
    .trim();
}

function stripHtml(fragment) {
  const doc = new DOMParser().parseFromString(fragment, 'text/html');
  insertBlockBreaks(doc.body);
  return tidyExtractedText(doc.body.textContent || '');
}

// Cherche un objet JobPosting dans les blocs JSON-LD de la page : c'est la
// source la plus fiable, la plupart des sites d'offres l'émettent pour leur
// référencement. On explore aussi les tableaux et les @graph, où l'objet
// peut être imbriqué.
function findJobPosting(value) {
  if (!value || typeof value !== 'object') return null;
  if (Array.isArray(value)) {
    for (const item of value) {
      const found = findJobPosting(item);
      if (found) return found;
    }
    return null;
  }
  const type = value['@type'];
  const types = Array.isArray(type) ? type : [type];
  if (types.includes('JobPosting')) return value;
  if (Array.isArray(value['@graph'])) return findJobPosting(value['@graph']);
  return null;
}

function extractFromJsonLd(doc) {
  const scripts = doc.querySelectorAll('script[type="application/ld+json"]');
  for (const script of scripts) {
    let data;
    try {
      data = JSON.parse(script.textContent);
    } catch {
      continue; // JSON-LD malformé : on passe au bloc suivant
    }
    const posting = findJobPosting(data);
    if (!posting) continue;
    const lines = [];
    // Titre en première ligne, entreprise juste après au format attendu par
    // defaultVersionName() / extractJobTitle() / extractCompanyName().
    if (posting.title) lines.push(String(posting.title).trim());
    const orgName = posting.hiringOrganization && posting.hiringOrganization.name;
    if (orgName) lines.push(`Entreprise : ${String(orgName).trim()}`);
    if (posting.description) lines.push(stripHtml(String(posting.description)));
    const text = lines.filter(Boolean).join('\n\n').trim();
    if (text) return text;
  }
  return '';
}

// Repli quand la page n'a pas de JSON-LD exploitable : on nettoie le HTML
// (scripts, styles, navigation...) puis on prend le texte du conteneur le
// plus probable pour une fiche de poste.
function extractFromBody(doc) {
  doc.querySelectorAll('script, style, nav, header, footer, noscript').forEach((n) => n.remove());
  const container =
    doc.querySelector('article') ||
    doc.querySelector('[class*="description"]') ||
    doc.querySelector('main') ||
    doc.body;
  if (container) insertBlockBreaks(container);
  return tidyExtractedText((container && container.textContent) || '');
}

// Transforme le HTML brut d'une page d'offre en texte exploitable, en
// document inerte (jamais inséré dans la page réelle).
function extractJobTextFromHtml(html) {
  const doc = new DOMParser().parseFromString(html, 'text/html');
  return extractFromJsonLd(doc) || extractFromBody(doc);
}

async function fetchJobFromUrl() {
  let url = jobUrlEl.value.trim();
  if (!url) {
    setJobUrlStatus('Collez d’abord un lien vers l’offre.', true);
    return;
  }
  if (!/^https?:\/\//i.test(url)) url = `https://${url}`;

  const btn = $('#fetchJobBtn');
  btn.disabled = true;
  const label = btn.textContent;
  btn.textContent = 'Récupération…';
  setJobUrlStatus('Récupération de l’offre…', false);
  try {
    let res;
    try {
      res = await fetch(FETCH_JOB_ENDPOINT, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url }),
      });
    } catch {
      // Backend injoignable : pas de serveur (mode file://) ou réseau coupé.
      throw new Error('BACKEND_UNAVAILABLE');
    }
    let payload = {};
    try {
      payload = await res.json();
    } catch {
      payload = {};
    }
    if (!res.ok) {
      const reason = typeof payload.error === 'string' && payload.error ? payload.error : `HTTP ${res.status}`;
      throw new Error(`BACKEND_ERROR:${reason}`);
    }
    const text = extractJobTextFromHtml(payload.html || '');
    if (!text) throw new Error('NO_TEXT');

    jobTextEl.value = text;
    runAnalysis();
    setJobUrlStatus('Offre récupérée et analysée ✓', false);
  } catch (err) {
    const message = err && err.message === 'BACKEND_UNAVAILABLE'
      ? 'Impossible de joindre le serveur (êtes-vous sur file:// ou le serveur est-il arrêté ?). Copiez-collez le texte de l’offre ci-dessous.'
      : err && err.message === 'NO_TEXT'
        ? 'Cette page ne contient pas de texte d’offre exploitable. Copiez-collez le texte de l’offre ci-dessous.'
        : err && err.message.startsWith('BACKEND_ERROR:')
          ? `Impossible de récupérer cette page (${err.message.slice('BACKEND_ERROR:'.length)}). Copiez-collez le texte de l’offre ci-dessous.`
          : 'Impossible de récupérer cette page. Copiez-collez le texte de l’offre ci-dessous.';
    setJobUrlStatus(message, true);
  } finally {
    btn.disabled = false;
    btn.textContent = label;
  }
}

$('#fetchJobBtn').addEventListener('click', fetchJobFromUrl);

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

// Titre à afficher dans les métadonnées du PDF (onglet Acrobat, etc.) : le nom
// de la version sauvegardée actuellement chargée, sinon le nom du profil.
function currentCvTitle() {
  const active = state.activeVersionId && state.versions.find((v) => v.id === state.activeVersionId);
  return (active && active.name) || state.profile.name || 'CV';
}

async function backendPdf(title) {
  const res = await fetch(PDF_ENDPOINT, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ html: cvEl.outerHTML, title }),
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
    const title = currentCvTitle();
    let blob;
    try {
      blob = await backendPdf(title);
    } catch (err) {
      console.info('Backend PDF indisponible, génération côté client.', err);
      // Même contenu que la feuille imprimée : ordre de tirets de la
      // proposition (comme à l'écran), blocs à maxVisible === 0 exclus (ils
      // ne s'impriment pas) et tirets au-delà de la limite coupés
      // (visibleBullets) — pdf.js itère tel quel sur ce qu'on lui passe.
      const printedBlocks = (items) =>
        items.filter((it) => it.maxVisible !== 0).map((it) => ({ ...it, bullets: visibleBullets(it) }));
      blob = await generateCvPdf({
        ...state,
        experiences: printedBlocks(state.experiences),
        education: printedBlocks(state.education),
        projects: printedBlocks(state.projects),
      }, title);
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
  // La Bibliothèque est indépendante du CV de base (voir normalizeState) :
  // la réinitialisation de celui-ci ne doit surtout pas y toucher.
  const { versions, activeTab, library } = state;
  state = { ...defaultCV(), versions, activeVersionId: null, proposal: null, activeTab, library };
  jobTextEl.value = '';
  rerender();
});

$('#exportBtn').addEventListener('click', () => {
  // On n'exporte que le CV actuellement affiché (page active), pas les
  // autres CV sauvegardés ni l'offre en cours : voir snapshotCV().
  // La photo (base64) est volontairement exclue : elle alourdirait énormément
  // le fichier pour un usage de sauvegarde/transfert de texte. À l'import, la
  // photo déjà affichée est conservée telle quelle (voir plus bas).
  const data = snapshotCV();
  delete data.profile.photo;
  delete data.profile.photoSrc;
  delete data.profile.photoCrop;
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
  const a = el('a', { href: URL.createObjectURL(blob), download: 'cv.json' });
  document.body.append(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(a.href);
});

$('#importBtn').addEventListener('click', () => $('#importFile').click());

function importCvFile(file) {
  if (!file) return;
  const reader = new FileReader();
  reader.onload = () => {
    try {
      const data = JSON.parse(reader.result);
      if (!data || typeof data !== 'object' || !data.profile || !Array.isArray(data.experiences)) {
        throw new Error('format');
      }
      // Ne remplace que le CV affiché (comme « Charger » une version) : les
      // autres CV sauvegardés restent intacts. La photo n'est jamais dans le
      // JSON exporté : on garde celle déjà affichée plutôt que l'effacer.
      const { photo, photoSrc, photoCrop } = state.profile;
      applyCV(data);
      state.profile.photo = photo;
      state.profile.photoSrc = photoSrc;
      state.profile.photoCrop = photoCrop;
      state.proposal = null;
      state.activeVersionId = null;
      rerender();
    } catch {
      alert('Fichier invalide : attendu un export JSON de cet éditeur.');
    }
  };
  reader.readAsText(file);
}

$('#importFile').addEventListener('change', (e) => {
  const file = e.target.files[0];
  e.target.value = '';
  importCvFile(file);
});

// Glisser-déposer d'un fichier .json directement sur la zone dédiée, sous
// les boutons Importer/Exporter JSON.
const jsonDropzoneEl = $('#jsonDropzone');
['dragenter', 'dragover'].forEach((type) => {
  jsonDropzoneEl.addEventListener(type, (e) => {
    e.preventDefault();
    jsonDropzoneEl.classList.add('drop-over');
  });
});
['dragleave', 'dragend'].forEach((type) => {
  jsonDropzoneEl.addEventListener(type, () => jsonDropzoneEl.classList.remove('drop-over'));
});
jsonDropzoneEl.addEventListener('drop', (e) => {
  e.preventDefault();
  jsonDropzoneEl.classList.remove('drop-over');
  importCvFile(e.dataTransfer.files && e.dataTransfer.files[0]);
});

// Appelé par extension/popup.js via chrome.scripting.executeScript (world
// MAIN) dans l'onglet de l'app : remplit le panneau « Offre d'emploi » avec
// l'offre WTTJ lue par l'extension, bascule sur l'onglet « Nouveau CV » et
// renvoie un prompt qui demande un CV JSON adapté à l'offre, à coller dans
// « Partir de votre CV existant » — c'est la popup qui le copie dans le
// presse-papiers, pas cette fonction. Aucune analyse n'est lancée ici.
// À incrémenter à chaque changement du prompt renvoyé à l'extension : permet
// à popup.js de détecter un onglet app resté ouvert sur une ancienne version
// et de le recharger avant de demander le prompt.
window.cvPromptVersion = 2;

window.cvPromptForJob = (job) => {
  if (!job || typeof job !== 'object') return { error: 'Offre invalide.' };
  if (!state.experiences.length) return { error: 'CV vide : remplissez d’abord votre CV dans l’Éditeur.' };
  jobTextEl.value = [job.title, job.company && `Entreprise : ${job.company}`, job.description].filter(Boolean).join('\n\n');
  state.jobText = jobTextEl.value;
  if (jobUrlEl && job.url) jobUrlEl.value = job.url;
  save();
  state.activeTab = 'create';
  rerender();
  return buildJobCvPrompt();
};

/* ---------- Démarrage ---------- */

jobTextEl.value = state.jobText;
rerender();
