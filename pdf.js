'use strict';

/* ============================================================
   Génération du PDF « vectoriel » (comme Canva)

   Le PDF est écrit directement, sans bibliothèque : chaque texte
   est un vrai texte PDF (polices Helvetica standard), pas une
   image. Résultat :
   - net à tous les niveaux de zoom, sélectionnable, léger ;
   - lisible par les ATS : les textes sont émis dans le flux
     du document dans l'ordre logique (nom, titre, résumé,
     expériences, formation, compétences), avec des titres de
     section explicites.
   ============================================================ */

// Tout le module est isolé dans une IIFE : app.js définit déjà des
// fonctions renderPro / renderDesign (rendu DOM) qui entreraient en
// collision avec celles-ci. Seul generateCvPdf est exposé.
(() => {

/* ---------- Constantes de page (A4 en points PDF) ---------- */

const PT_PER_MM = 72 / 25.4;
const PAGE_W = 210 * PT_PER_MM; // 595.28
const PAGE_H = 297 * PT_PER_MM; // 841.89

// Largeur du bandeau coloré du modèle « design » : 55 mm sur les 210 mm de
// l'A4. Sert à la fois au fond coloré (makeDoc) et à la mise en page
// (renderDesign) ; doit rester identique à la colonne de grille de styles.css
// (.sheet.design → grid-template-columns).
const SIDE_W = 55 * PT_PER_MM;

// 1 px CSS = 0.75 pt : les tailles reprennent celles de styles.css
const PX = 0.75;

// Interlignes de styles.css : 1.45 partout, resserré à 1.34 dans le modèle
// « design » (règles `.sheet.design .main` / `.sheet.design .side`), qui doit
// faire tenir Expériences + Formation + Projets sur une seule page.
const LINE_PRO = 1.45;
const LINE_DESIGN = 1.34;
let LINE = LINE_PRO; // fixé par generateCvPdf selon le modèle

/* ---------- Couleurs (mêmes valeurs que styles.css) ---------- */

const C = {
  accent: [0x25 / 255, 0x63 / 255, 0xeb / 255],
  ink: [0x1f / 255, 0x29 / 255, 0x37 / 255],
  muted: [0x6b / 255, 0x72 / 255, 0x80 / 255],
};

/* ============================================================
   Palette de la barre latérale — source de vérité unique

   La couleur du bandeau est choisie par l'utilisateur, donc toutes
   les teintes qui en dépendent (texte, filets, anneau photo) sont
   dérivées ici. app.js applique le résultat aux variables CSS
   --side-bg / --side-fg ; styles.css redérive les mêmes nuances avec
   color-mix() et les MÊMES ratios. Écran et PDF restent identiques.
   ============================================================ */

const SIDE_BG_DEFAULT = '#1f3a5f';
const SIDE_FG_LIGHT = [1, 1, 1]; // #fff sur fond sombre
const SIDE_FG_DARK = [0x1f / 255, 0x29 / 255, 0x37 / 255]; // --ink sur fond clair

// Ratios repris tels quels dans styles.css (voir .sheet.design .side)
const SIDE_RATIO = { ink: 0.88, rule: 0.4, ring: 0.55 };

const HEX_RE = /^#(?:[0-9a-f]{3}|[0-9a-f]{6})$/i;

function parseHex(hex) {
  if (typeof hex !== 'string' || !HEX_RE.test(hex.trim())) return null;
  let h = hex.trim().slice(1);
  if (h.length === 3) h = h[0] + h[0] + h[1] + h[1] + h[2] + h[2];
  const n = parseInt(h, 16);
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
}

const toHex = ([r, g, b]) =>
  '#' + [r, g, b].map((c) => Math.round(c * 255).toString(16).padStart(2, '0')).join('');

// Luminance relative WCAG (canal sRGB linéarisé)
function luminance([r, g, b]) {
  const lin = (c) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
}

const contrast = (l1, l2) => (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05);

// fg * ratio aplati sur bg — équivaut exactement à rgba(fg, ratio) sur bg opaque
const mix = (fg, bg, ratio) => fg.map((c, i) => c * ratio + bg[i] * (1 - ratio));

/* Renvoie la palette complète du bandeau pour une couleur donnée.
   Une valeur invalide ou absente retombe sur la couleur par défaut. */
function cvSidePalette(hex) {
  const bg = parseHex(hex) || parseHex(SIDE_BG_DEFAULT);
  const lBg = luminance(bg);
  // On garde le texte qui contraste le mieux : blanc sur fond sombre,
  // encre sombre dès que le fond devient clair (sinon illisible).
  const fg =
    contrast(lBg, luminance(SIDE_FG_LIGHT)) >= contrast(lBg, luminance(SIDE_FG_DARK))
      ? SIDE_FG_LIGHT
      : SIDE_FG_DARK;
  return {
    bg,
    fg,
    ink: mix(fg, bg, SIDE_RATIO.ink),
    rule: mix(fg, bg, SIDE_RATIO.rule),
    ring: mix(fg, bg, SIDE_RATIO.ring),
    bgHex: toHex(bg),
    fgHex: toHex(fg),
  };
}

/* ============================================================
   Tailles de police — source de vérité unique

   Chaque « rôle » de texte (nom, titre, points…) est réglable par
   l'utilisateur, séparément pour chaque zone : la barre latérale
   (`side`, modèle design) et la colonne principale (`main`, qui est
   tout le CV dans le modèle pro). Les valeurs par défaut sont celles
   de styles.css.

   Trois consommateurs, une seule table :
   - app.js construit les réglages de l'interface à partir d'elle et
     pose `var` en ligne sur .sheet (l'écran, l'impression et le PDF
     backend suivent alors la même valeur) ;
   - ce générateur PDF de secours lit les mêmes tailles ;
   - `derived` couvre les tailles qui suivent une autre sans réglage
     propre (la valeur d'un contact, la période d'une expérience) :
     elles gardent leur rapport d'origine avec la taille réglée.
   ============================================================ */

const FS_MIN = 6;
const FS_MAX = 40;

const FONT_ROLES = {
  pro: {
    main: [
      { key: 'name', label: 'Nom', def: 28, cssVar: '--fs-name' },
      { key: 'title', label: 'Titre', def: 17, cssVar: '--fs-title' },
      {
        key: 'contact', label: 'Contact et liens', def: 13, cssVar: '--fs-contact',
        derived: [{ key: 'contactValue', cssVar: '--fs-contact-value', ratio: 12.5 / 13 }],
      },
      { key: 'summary', label: 'Résumé', def: 14, cssVar: '--fs-summary' },
      { key: 'section', label: 'Titres de section', def: 15, cssVar: '--fs-section' },
      { key: 'item', label: 'Postes et diplômes', def: 15, cssVar: '--fs-item' },
      {
        key: 'detail', label: 'Entreprise et détail', def: 14, cssVar: '--fs-detail',
        derived: [{ key: 'period', cssVar: '--fs-period', ratio: 13 / 14 }],
      },
      { key: 'bullet', label: 'Points', def: 14, cssVar: '--fs-bullet' },
      { key: 'skills', label: 'Compétences', def: 14, cssVar: '--fs-skills' },
    ],
  },
  design: {
    side: [
      // 24 px : la taille que la feuille affiche réellement (règle
      // `.sheet.design .cv-name`, plus spécifique que `.side .cv-name`).
      // Ce générateur de secours dessinait le nom en 17 px, à rebours de
      // l'écran et du PDF backend — les trois s'accordent désormais.
      { key: 'name', label: 'Nom', def: 24, cssVar: '--fs-side-name' },
      { key: 'section', label: 'Titres de section', def: 12, cssVar: '--fs-side-section' },
      {
        key: 'contact', label: 'Contact et liens', def: 12, cssVar: '--fs-side-contact',
        derived: [{ key: 'contactValue', cssVar: '--fs-side-contact-value', ratio: 11.5 / 12 }],
      },
      { key: 'skills', label: 'Compétences', def: 11.5, cssVar: '--fs-side-skills' },
    ],
    main: [
      { key: 'title', label: 'Titre', def: 15, cssVar: '--fs-title' },
      { key: 'summary', label: 'Résumé', def: 13, cssVar: '--fs-summary' },
      { key: 'section', label: 'Titres de section', def: 13.5, cssVar: '--fs-section' },
      { key: 'item', label: 'Postes et diplômes', def: 13.5, cssVar: '--fs-item' },
      {
        key: 'detail', label: 'Entreprise et détail', def: 12.5, cssVar: '--fs-detail',
        derived: [{ key: 'period', cssVar: '--fs-period', ratio: 12 / 12.5 }],
      },
      { key: 'bullet', label: 'Points', def: 12.5, cssVar: '--fs-bullet' },
    ],
  },
};

// Une taille réglée n'est retenue que si c'est un nombre dans les bornes ;
// tout le reste (ancienne sauvegarde, JSON trafiqué) retombe sur le défaut.
function clampFontSize(v, def) {
  const n = typeof v === 'number' ? v : parseFloat(v);
  if (!Number.isFinite(n)) return def;
  return Math.min(FS_MAX, Math.max(FS_MIN, Math.round(n * 2) / 2));
}

/* Tailles effectives d'un modèle : { zone: { role: px, roleDérivé: px } }.
   `sizes` est l'objet stocké dans l'état (state.fontSizes[template]). */
function cvFontSizes(sizes, template) {
  const zones = FONT_ROLES[template === 'design' ? 'design' : 'pro'];
  const stored = sizes && typeof sizes === 'object' ? sizes : {};
  const out = {};
  for (const [zone, roles] of Object.entries(zones)) {
    const from = stored[zone] && typeof stored[zone] === 'object' ? stored[zone] : {};
    const vals = {};
    for (const r of roles) {
      vals[r.key] = clampFontSize(from[r.key], r.def);
      for (const d of r.derived || []) vals[d.key] = Math.round(vals[r.key] * d.ratio * 10) / 10;
    }
    out[zone] = vals;
  }
  return out;
}

/* ============================================================
   Métriques Helvetica (largeurs AFM, en millièmes de cadratin)
   — nécessaires pour couper les lignes exactement.
   ============================================================ */

// Caractères 32 à 126
const W_REG = [
  278, 278, 355, 556, 556, 889, 667, 191, 333, 333, 389, 584, 278, 333, 278, 278,
  556, 556, 556, 556, 556, 556, 556, 556, 556, 556, 278, 278, 584, 584, 584, 556,
  1015, 667, 667, 722, 722, 667, 611, 778, 722, 278, 500, 667, 556, 833, 722, 778,
  667, 778, 722, 667, 611, 722, 667, 944, 667, 667, 611, 278, 278, 278, 469, 556,
  333, 556, 556, 500, 556, 556, 278, 556, 556, 222, 222, 500, 222, 833, 556, 556,
  556, 556, 333, 500, 278, 556, 500, 722, 500, 500, 500, 334, 260, 334, 584,
];

const W_BOLD = [
  278, 333, 474, 556, 556, 889, 722, 238, 333, 333, 389, 584, 278, 333, 278, 278,
  556, 556, 556, 556, 556, 556, 556, 556, 556, 556, 333, 333, 584, 584, 584, 611,
  975, 722, 722, 722, 722, 667, 611, 778, 722, 278, 556, 722, 611, 833, 722, 778,
  667, 778, 722, 667, 611, 722, 667, 944, 667, 667, 611, 333, 278, 333, 584, 556,
  333, 556, 611, 556, 611, 556, 333, 611, 611, 278, 278, 556, 278, 889, 611, 611,
  611, 611, 389, 556, 333, 611, 556, 778, 556, 556, 500, 389, 280, 389, 584,
];

// Caractères hors ASCII fréquents : { codePoint: [regular, bold] }
const W_EXTRA = {
  0x00a0: [278, 278], // espace insécable
  0x00b0: [400, 400], // °
  0x00b7: [278, 278], // ·
  0x00ab: [556, 556], // «
  0x00bb: [556, 556], // »
  0x00df: [611, 611], // ß
  0x00e6: [889, 889], // æ
  0x00c6: [1000, 1000], // Æ
  0x00f8: [611, 611], // ø
  0x00d8: [778, 778], // Ø
  0x0152: [1000, 1000], // Œ
  0x0153: [944, 944], // œ
  0x2013: [556, 556], // –
  0x2014: [1000, 1000], // —
  0x2018: [222, 278], // ‘
  0x2019: [222, 278], // ’
  0x201c: [333, 500], // “
  0x201d: [333, 500], // ”
  0x2022: [350, 350], // •
  0x2026: [1000, 1000], // …
  0x20ac: [556, 556], // €
  0x2122: [1000, 1000], // ™
};

function glyphWidth(ch, bold) {
  const code = ch.codePointAt(0);
  if (code >= 32 && code <= 126) return (bold ? W_BOLD : W_REG)[code - 32];
  if (W_EXTRA[code]) return W_EXTRA[code][bold ? 1 : 0];
  // Lettre accentuée : même chasse que la lettre de base en Helvetica
  const base = ch.normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  const b = base.codePointAt(0);
  if (b >= 32 && b <= 126) return (bold ? W_BOLD : W_REG)[b - 32];
  return 556;
}

function measure(text, bold, size, charSpace = 0) {
  let w = 0;
  let count = 0;
  for (const ch of text) {
    w += glyphWidth(ch, bold);
    count++;
  }
  w = (w * size) / 1000;
  if (charSpace && count > 1) w += charSpace * (count - 1);
  return w;
}

/* ============================================================
   Encodage WinAnsi (CP1252) : couvre le français (é à ç œ € …)
   ============================================================ */

const CP1252 = {
  0x20ac: 0x80, 0x201a: 0x82, 0x0192: 0x83, 0x201e: 0x84, 0x2026: 0x85,
  0x2020: 0x86, 0x2021: 0x87, 0x02c6: 0x88, 0x2030: 0x89, 0x0160: 0x8a,
  0x2039: 0x8b, 0x0152: 0x8c, 0x017d: 0x8e, 0x2018: 0x91, 0x2019: 0x92,
  0x201c: 0x93, 0x201d: 0x94, 0x2022: 0x95, 0x2013: 0x96, 0x2014: 0x97,
  0x02dc: 0x98, 0x2122: 0x99, 0x0161: 0x9a, 0x203a: 0x9b, 0x0153: 0x9c,
  0x017e: 0x9e, 0x0178: 0x9f,
};

// Convertit une chaîne JS en chaîne PDF échappée (octets WinAnsi)
function pdfString(text) {
  let out = '';
  for (const ch of text) {
    const code = ch.codePointAt(0);
    let byte;
    if (code === 0x0a || code === 0x0d || code === 0x09) byte = 0x20;
    else if (code < 0x80 || (code >= 0xa0 && code <= 0xff)) byte = code;
    else if (CP1252[code] !== undefined) byte = CP1252[code];
    else {
      const base = ch.normalize('NFD').replace(/[\u0300-\u036f]/g, '');
      const b = base ? base.codePointAt(0) : 63;
      byte = b < 0x80 || (b >= 0xa0 && b <= 0xff) ? b : 63; // '?'
    }
    if (byte === 0x28 || byte === 0x29 || byte === 0x5c) out += '\\';
    out += String.fromCharCode(byte);
  }
  return out;
}

/* ============================================================
   Primitives de dessin (opérateurs PDF)
   ============================================================ */

const num = (v) => String(Math.round(v * 100) / 100);
const rgb = ([r, g, b]) => `${num(r)} ${num(g)} ${num(b)}`;

// y est toujours mesuré depuis le HAUT de la page ; conversion ici.
function opText(page, x, yBaseline, text, { bold = false, size, color, charSpace = 0 }) {
  const font = bold ? 'F2' : 'F1';
  let op = `BT /${font} ${num(size)} Tf ${rgb(color)} rg `;
  if (charSpace) op += `${num(charSpace)} Tc `;
  op += `${num(x)} ${num(PAGE_H - yBaseline)} Td (${pdfString(text)}) Tj`;
  if (charSpace) op += ' 0 Tc';
  op += ' ET';
  page.ops.push(op);
}

function opRect(page, x, yTop, w, h, color) {
  page.ops.push(`${rgb(color)} rg ${num(x)} ${num(PAGE_H - yTop - h)} ${num(w)} ${num(h)} re f`);
}

// Chemin circulaire (4 courbes de Bézier), utilisé pour la photo
function circlePath(cx, cyTop, r) {
  const cy = PAGE_H - cyTop;
  const k = 0.5522847 * r;
  return (
    `${num(cx + r)} ${num(cy)} m ` +
    `${num(cx + r)} ${num(cy + k)} ${num(cx + k)} ${num(cy + r)} ${num(cx)} ${num(cy + r)} c ` +
    `${num(cx - k)} ${num(cy + r)} ${num(cx - r)} ${num(cy + k)} ${num(cx - r)} ${num(cy)} c ` +
    `${num(cx - r)} ${num(cy - k)} ${num(cx - k)} ${num(cy - r)} ${num(cx)} ${num(cy - r)} c ` +
    `${num(cx + k)} ${num(cy - r)} ${num(cx + r)} ${num(cy - k)} ${num(cx + r)} ${num(cy)} c h`
  );
}

// Photo ronde : découpe circulaire + image JPEG, anneau optionnel
function opPhoto(page, x, yTop, size, ring) {
  const cx = x + size / 2;
  const cyTop = yTop + size / 2;
  const r = size / 2;
  page.ops.push(
    `q ${circlePath(cx, cyTop, r)} W n ` +
      `${num(size)} 0 0 ${num(size)} ${num(x)} ${num(PAGE_H - yTop - size)} cm /Im1 Do Q`
  );
  if (ring) {
    page.ops.push(`q ${rgb(ring)} RG 2.25 w ${circlePath(cx, cyTop, r - 1.1)} S Q`);
  }
}

/* ============================================================
   Flux de mise en page : colonnes avec pagination automatique
   ============================================================ */

function makeDoc(state) {
  const doc = { pages: [], template: state.template, annots: [] };
  // Palette du bandeau dérivée de la couleur choisie par l'utilisateur
  doc.side = cvSidePalette(state.sideColor);
  doc.newPage = () => {
    const page = { ops: [], annots: [] };
    if (state.template === 'design') {
      // Fond de la barre latérale répété sur chaque page
      page.ops.push(`${rgb(doc.side.bg)} rg 0 0 ${num(SIDE_W)} ${num(PAGE_H)} re f`);
    }
    doc.pages.push(page);
    return page;
  };
  doc.newPage();
  return doc;
}

function makeCol(doc, x, width, top, bottom) {
  return {
    doc, x, width, top, bottom,
    pageIndex: 0,
    y: top,
    page() {
      while (this.doc.pages.length <= this.pageIndex) this.doc.newPage();
      return this.doc.pages[this.pageIndex];
    },
    // Saute de page si `h` ne tient pas dans la colonne
    ensure(h) {
      if (this.y + h <= PAGE_H - this.bottom) return;
      this.pageIndex++;
      this.y = this.top;
      this.page();
    },
  };
}

/* ---------- Coupure de lignes sur des segments stylés ---------- */

// segs : [{ text, bold, size, color }] ; retourne des lignes de « runs »
function wrapSegments(segs, firstWidth, restWidth) {
  const lines = [];
  let line = [];
  let w = 0;
  let max = firstWidth;

  const pushLine = () => {
    while (line.length && /^\s+$/.test(line[line.length - 1].text)) {
      w -= line.pop().width;
    }
    lines.push({ runs: line, width: w });
    line = [];
    w = 0;
    max = restWidth;
  };

  for (const seg of segs) {
    if (!seg.text) continue;
    for (let token of seg.text.split(/(\s+)/)) {
      if (!token) continue;
      const isSpace = /^\s+$/.test(token);
      if (isSpace) {
        if (line.length === 0) continue;
        const tw = measure(' ', seg.bold, seg.size);
        line.push({ text: ' ', seg, width: tw });
        w += tw;
        continue;
      }
      let tw = measure(token, seg.bold, seg.size);
      if (w + tw > max && w > 0) pushLine();
      // Mot plus large que la colonne : coupure par caractères
      while (tw > max && token.length > 1) {
        let cut = token.length - 1;
        while (cut > 1 && measure(token.slice(0, cut), seg.bold, seg.size) > max) cut--;
        const head = token.slice(0, cut);
        line.push({ text: head, seg, width: measure(head, seg.bold, seg.size) });
        w += line[line.length - 1].width;
        pushLine();
        token = token.slice(cut);
        tw = measure(token, seg.bold, seg.size);
      }
      line.push({ text: token, seg, width: tw });
      w += tw;
    }
  }
  if (line.length) pushLine();
  return lines;
}

// Dessine des lignes préparées par wrapSegments ; retourne les rectangles
// réellement occupés (pour poser des annotations de lien).
function drawLines(col, lines, { lineH, indent = 0, url = null } = {}) {
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    col.ensure(lineH);
    const page = col.page();
    const baseSize = line.runs.reduce((m, r) => Math.max(m, r.seg.size), 0);
    const baseline = col.y + baseSize * 0.8;
    let x = col.x + indent;
    // Fusion des runs consécutifs de même style en un seul Tj
    let run = null;
    const flush = () => {
      if (!run) return;
      opText(page, run.x, baseline, run.text, run.seg);
      run = null;
    };
    for (const r of line.runs) {
      if (run && run.seg === r.seg) run.text += r.text;
      else {
        flush();
        run = { x, text: r.text, seg: r.seg };
      }
      x += r.width;
    }
    flush();
    if (url && line.width > 0) {
      page.annots.push({
        url,
        rect: [col.x + indent, PAGE_H - col.y - lineH, col.x + indent + line.width, PAGE_H - col.y],
      });
    }
    col.y += lineH;
  }
}

// Paragraphe d'un seul style
function paragraph(col, text, style, opts = {}) {
  text = (text || '').trim();
  if (!text) return;
  const indent = opts.indent || 0;
  const lines = wrapSegments([{ text, ...style }], col.width - indent, col.width - indent);
  drawLines(col, lines, { lineH: opts.lineH || style.size * LINE, indent, url: opts.url });
}

// Champ de contact : la valeur seule, sans intitulé ni annotation d'URL —
// cf. .contact-value en CSS.
function contactItem(col, item, { valueColor, size, valueSize }) {
  const value = (item.value || '').trim();
  if (!value) return;
  const segs = [{ text: value, bold: false, size: valueSize, color: valueColor }];
  const lines = wrapSegments(segs, col.width, col.width);
  drawLines(col, lines, { lineH: size * LINE });
}

function contactLines(col, state, style) {
  for (const item of state.profile.contact) contactItem(col, item, style);
}

/* ---------- Blocs du CV ---------- */

function sectionTitle(col, text, { size, color, ruleColor, mt, mb }) {
  // On garde le titre attaché à la première ligne du contenu qui suit
  col.ensure(mt + size * LINE + 4 + mb + size * LINE);
  col.y += mt;
  opText(col.page(), col.x, col.y + size * 0.8, text.toUpperCase(), {
    bold: true, size, color, charSpace: size * 0.06,
  });
  col.y += size * LINE + 3 * PX;
  opRect(col.page(), col.x, col.y, col.width, 2 * PX, ruleColor);
  col.y += 2 * PX + mb;
}

function bulletItem(col, text, { size, color, dotColor }) {
  text = (text || '').trim();
  if (!text) return;
  const indent = 12;
  const lineH = size * LINE;
  const lines = wrapSegments([{ text, bold: false, size, color }], col.width - indent, col.width - indent);
  col.ensure(2 * PX + lineH); // au moins la première ligne avec la puce
  col.y += 2 * PX;
  opText(col.page(), col.x + 2, col.y + size * 0.8, '•', { size, color: dotColor });
  drawLines(col, lines, { lineH, indent });
  col.y += 2 * PX;
}

// Sous-section « Formation / Projets » : titre en gras + détail atténué (comme
// le rôle et l'entreprise d'une expérience, sans période), puis ses points.
// Même structure que experienceBlock(), en plus compact.
function subsectionBlock(col, item, palette, sizes = {}) {
  const { title: titleSize = 15, detail: detailPx = 14, bullet = 14, gap = 14 } = sizes;
  const tSize = titleSize * PX;
  const headSegs = [{ text: (item.title || '').trim(), bold: true, size: tSize, color: palette.ink }];
  const detail = (item.detail || '').trim();
  if (detail) {
    headSegs.push(
      { text: '  —  ', bold: false, size: detailPx * PX, color: palette.muted },
      { text: detail, bold: false, size: detailPx * PX, color: palette.muted }
    );
  }
  const lines = wrapSegments(headSegs, col.width, col.width);
  const lineH = tSize * LINE;

  col.ensure(lines.length * lineH + 4.5 + 10.5 * PX * LINE);
  drawLines(col, lines, { lineH });

  col.y += 4.5;
  for (const b of item.bullets) {
    bulletItem(col, b.text, { size: bullet * PX, color: palette.ink, dotColor: palette.ink });
  }
  col.y += gap * PX;
}

function linkHref(url) {
  const u = (url || '').trim();
  if (!u) return null;
  return /^[a-z][a-z0-9+.-]*:/i.test(u) ? u : 'https://' + u;
}

// Lien hypertexte : seul le texte libre est écrit, et c'est lui qui porte
// l'annotation cliquable vers l'URL (invisible sur le CV). Sans texte, on
// retombe sur l'URL — c'est le cas des données antérieures aux hyperliens.
function linkItem(col, link, { urlColor, labelSize, urlSize }) {
  const label = (link.label || '').trim();
  const url = (link.url || '').trim();
  const text = label || url;
  if (!text) return;
  const segs = [{ text, bold: false, size: urlSize, color: urlColor }];
  const lines = wrapSegments(segs, col.width, col.width);
  col.y += 1 * PX;
  drawLines(col, lines, { lineH: labelSize * LINE, url: linkHref(url) });
  col.y += 1 * PX;
}

// sizes (en px CSS) : par défaut celles du modèle « pro ».
function experienceBlock(col, exp, palette, sizes = {}) {
  const { role = 15, company: companySize = 14, period: periodPx = 13, bullet = 14, gap = 14 } = sizes;
  const roleSize = role * PX;
  const headSegs = [{ text: (exp.role || '').trim(), bold: true, size: roleSize, color: palette.ink }];
  const company = (exp.company || '').trim();
  if (company) {
    headSegs.push(
      { text: '  —  ', bold: false, size: companySize * PX, color: palette.muted },
      { text: company, bold: false, size: companySize * PX, color: palette.muted }
    );
  }
  const period = (exp.period || '').trim();
  const periodSize = periodPx * PX;
  const periodW = period ? measure(period, false, periodSize) : 0;
  const firstWidth = col.width - (periodW ? periodW + 12 : 0);
  const lines = wrapSegments(headSegs, firstWidth, col.width);
  const lineH = roleSize * LINE;

  // L'en-tête reste attaché à son premier tiret
  col.ensure(lines.length * lineH + 4.5 + 10.5 * PX * LINE);
  const headPage = col.page();
  const headY = col.y;
  drawLines(col, lines, { lineH });
  if (period) {
    opText(headPage, col.x + col.width - periodW, headY + roleSize * 0.8, period, {
      size: periodSize, color: palette.muted,
    });
  }

  col.y += 4.5; // marge avant les tirets
  for (const b of exp.bullets) {
    bulletItem(col, b.text, { size: bullet * PX, color: palette.ink, dotColor: palette.ink });
  }
  col.y += gap * PX; // marge entre expériences
}

// Sous-groupes de compétences (intitulé en gras + texte multiligne) et
// centres d'intérêt : rendus à la suite du bloc « Compétences ».
function skillGroupsBlock(col, groups, { size, labelColor, textColor }) {
  for (const g of groups || []) {
    const label = (g.label || '').trim();
    const text = (g.text || '').trim();
    if (!label && !text) continue;
    col.y += 5 * PX;
    if (label) paragraph(col, label, { bold: true, size, color: labelColor });
    for (const line of text.split('\n')) paragraph(col, line, { size, color: textColor });
  }
}

function interestsBlock(col, interests, { size, color }) {
  for (const it of interests || []) {
    const text = (it.text || '').trim();
    if (!text) continue;
    col.y += 4 * PX;
    for (const line of text.split('\n')) paragraph(col, line, { size, color });
  }
}

/* ---------- Modèle « Pro » (une colonne) ---------- */

function renderPro(doc, state, photo) {
  const ML = 16 * PT_PER_MM;
  const MT = 14 * PT_PER_MM;
  const contentW = PAGE_W - 2 * ML;
  const col = makeCol(doc, ML, contentW, MT, MT);
  const palette = { ink: C.ink, muted: C.muted };
  const f = cvFontSizes(state.fontSizes && state.fontSizes.pro, 'pro').main;

  const photoSize = 110 * PX;
  if (photo) col.width = contentW - photoSize - 24 * PX;

  paragraph(col, state.profile.name, { bold: true, size: f.name * PX, color: C.ink }, { lineH: f.name * PX * 1.2 });
  col.y += 2 * PX;
  paragraph(col, state.profile.title, { bold: true, size: f.title * PX, color: C.accent });
  col.y += 6 * PX;
  contactLines(col, state, {
    labelColor: C.ink, valueColor: C.muted, size: f.contact * PX, valueSize: f.contactValue * PX,
  });
  col.y += 8 * PX;
  for (const l of state.profile.links) {
    linkItem(col, l, {
      labelColor: C.ink, urlColor: C.muted, labelSize: f.contact * PX, urlSize: f.contactValue * PX,
    });
  }

  if (photo) {
    opPhoto(doc.pages[0], PAGE_W - ML - photoSize, MT, photoSize, null);
    col.y = Math.max(col.y, MT + photoSize);
    col.width = contentW;
  }

  col.y += 12 * PX;
  paragraph(col, state.profile.summary, { size: f.summary * PX, color: C.ink });

  const st = { size: f.section * PX, color: C.accent, ruleColor: C.accent, mt: 26 * PX, mb: 10 * PX };
  const expSizes = { role: f.item, company: f.detail, period: f.period, bullet: f.bullet, gap: 14 };
  const subSizes = { title: f.item, detail: f.detail, bullet: f.bullet, gap: 14 };
  if (state.experiences.length) {
    sectionTitle(col, 'Expériences professionnelles', st);
    for (const exp of state.experiences) experienceBlock(col, exp, palette, expSizes);
  }
  if (state.education.length) {
    sectionTitle(col, 'Formation', st);
    for (const ed of state.education) subsectionBlock(col, ed, palette, subSizes);
  }
  if (state.projects.length) {
    sectionTitle(col, 'Projets', st);
    for (const pr of state.projects) subsectionBlock(col, pr, palette, subSizes);
  }
  const hasSkills = (state.skills || '').trim() || (state.skillGroups || []).length;
  if (hasSkills) {
    sectionTitle(col, 'Compétences', st);
    paragraph(col, state.skills, { size: f.skills * PX, color: C.ink });
    skillGroupsBlock(col, state.skillGroups, { size: f.skills * PX, labelColor: C.ink, textColor: C.ink });
  }
  if ((state.interests || []).length) {
    sectionTitle(col, 'Intérêts', st);
    interestsBlock(col, state.interests, { size: f.skills * PX, color: C.ink });
  }
}

/* ---------- Modèle « Design » (barre latérale) ---------- */

function renderDesign(doc, state, photo) {
  // Mesures reprises de styles.css (section « Modèle design : densité ») :
  // .side padding 10mm 5.5mm, .main padding 10mm 9mm.
  const sideW = SIDE_W;
  const sidePad = 5.5 * PT_PER_MM;
  const mainPad = 9 * PT_PER_MM;
  const MT = 10 * PT_PER_MM;

  // Colonne principale d'abord : ses textes sont émis en premier dans le
  // flux PDF (titre, résumé, expériences, formation, projets) ; le nom est
  // dans la barre latérale, sous la photo.
  const main = makeCol(doc, sideW + mainPad, PAGE_W - sideW - 2 * mainPad, MT, MT);
  const palette = { ink: C.ink, muted: C.muted };
  const F = cvFontSizes(state.fontSizes && state.fontSizes.design, 'design');
  const fm = F.main;
  const stMain = { size: fm.section * PX, color: C.accent, ruleColor: C.accent, mt: 14 * PX, mb: 6 * PX };
  const expSizes = { role: fm.item, company: fm.detail, period: fm.period, bullet: fm.bullet, gap: 8 };
  const subSizes = { title: fm.item, detail: fm.detail, bullet: fm.bullet, gap: 8 };

  paragraph(main, state.profile.title, { bold: true, size: fm.title * PX, color: C.accent });
  main.y += 8 * PX;
  paragraph(main, state.profile.summary, { size: fm.summary * PX, color: C.ink });

  if (state.experiences.length) {
    sectionTitle(main, 'Expériences professionnelles', stMain);
    for (const exp of state.experiences) experienceBlock(main, exp, palette, expSizes);
  }
  if (state.education.length) {
    sectionTitle(main, 'Formation', stMain);
    for (const ed of state.education) subsectionBlock(main, ed, palette, subSizes);
  }
  if (state.projects.length) {
    sectionTitle(main, 'Projets', stMain);
    for (const pr of state.projects) subsectionBlock(main, pr, palette, subSizes);
  }

  // Barre latérale : photo, Contact, Liens, Compétences, Intérêts.
  // Toutes les teintes suivent la couleur choisie.
  const S = doc.side;
  const side = makeCol(doc, sidePad, sideW - 2 * sidePad, MT, MT);
  const fs = F.side;
  const stSide = { size: fs.section * PX, color: S.fg, ruleColor: S.rule, mt: 14 * PX, mb: 6 * PX };

  if (photo) {
    // 39 mm de diamètre extérieur, contour compris (identique à styles.css :
    // .side .cv-photo). L'anneau est tracé au bord de l'image, il n'ajoute
    // donc rien au-delà de photoSize.
    const photoSize = 39 * PT_PER_MM;
    opPhoto(side.page(), sidePad + (side.width - photoSize) / 2, side.y, photoSize, S.ring);
    side.y += photoSize;
  }
  side.y += 8 * PX;
  paragraph(side, state.profile.name, { bold: true, size: fs.name * PX, color: S.fg }, { lineH: fs.name * PX * 1.2 });

  if (state.profile.contact.length) {
    sectionTitle(side, 'Contact', stSide);
    contactLines(side, state, {
      labelColor: S.fg, valueColor: S.ink, size: fs.contact * PX, valueSize: fs.contactValue * PX,
    });
  }
  if (state.profile.links.length) {
    sectionTitle(side, 'Liens', stSide);
    for (const l of state.profile.links) {
      linkItem(side, l, {
        labelColor: S.fg, urlColor: S.ink, labelSize: fs.contact * PX, urlSize: fs.contactValue * PX,
      });
    }
  }
  // Bandeau : uniquement les groupes intitulés — le texte libre `skills`
  // n'apparaît que dans le modèle « pro » (voir renderDesign dans app.js).
  if ((state.skillGroups || []).length) {
    sectionTitle(side, 'Compétences', stSide);
    skillGroupsBlock(side, state.skillGroups, { size: fs.skills * PX, labelColor: S.fg, textColor: S.ink });
  }
  if ((state.interests || []).length) {
    sectionTitle(side, 'Intérêts', stSide);
    interestsBlock(side, state.interests, { size: fs.skills * PX, color: S.ink });
  }
}

/* ============================================================
   Photo : normalisation en JPEG (quel que soit le format stocké)
   ============================================================ */

function preparePhoto(dataUrl) {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => {
      // Recadrage carré centré (même logique qu'à l'écran)
      const s = Math.min(img.naturalWidth, img.naturalHeight) || 1;
      const size = Math.min(600, s);
      const canvas = document.createElement('canvas');
      canvas.width = size;
      canvas.height = size;
      const g = canvas.getContext('2d');
      g.fillStyle = '#fff';
      g.fillRect(0, 0, size, size);
      g.drawImage(img, (img.naturalWidth - s) / 2, (img.naturalHeight - s) / 2, s, s, 0, 0, size, size);
      const jpeg = canvas.toDataURL('image/jpeg', 0.85);
      const bin = atob(jpeg.split(',')[1]);
      const bytes = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
      resolve({ bytes, w: size, h: size });
    };
    img.onerror = () => resolve(null); // photo illisible : PDF sans photo
    img.src = dataUrl;
  });
}

/* ============================================================
   Assemblage du fichier PDF (objets, xref, trailer)
   ============================================================ */

function latin1Bytes(str) {
  const b = new Uint8Array(str.length);
  for (let i = 0; i < str.length; i++) b[i] = str.charCodeAt(i) & 0xff;
  return b;
}

function buildFile(doc, photo, meta) {
  const objects = []; // chaque objet : tableau de morceaux (string | Uint8Array)
  const addObj = (parts) => objects.push(parts) - 1 + 1; // ids à partir de 1

  const fontRegId = addObj([
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>',
  ]);
  const fontBoldId = addObj([
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>',
  ]);

  let imageId = 0;
  if (photo) {
    imageId = addObj([
      `<< /Type /XObject /Subtype /Image /Width ${photo.w} /Height ${photo.h} ` +
        `/ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode ` +
        `/Length ${photo.bytes.length} >>\nstream\n`,
      photo.bytes,
      '\nendstream',
    ]);
  }

  let resources = `<< /Font << /F1 ${fontRegId} 0 R /F2 ${fontBoldId} 0 R >>`;
  if (imageId) resources += ` /XObject << /Im1 ${imageId} 0 R >>`;
  resources += ' >>';
  const resourcesId = addObj([resources]);

  const pageIds = [];
  const pagesId = objects.length + doc.pages.length * 2 +
    doc.pages.reduce((n, p) => n + p.annots.length, 0) + 1;

  for (const page of doc.pages) {
    const content = page.ops.join('\n');
    const contentId = addObj([
      `<< /Length ${latin1Bytes(content).length} >>\nstream\n${content}\nendstream`,
    ]);
    const annotIds = page.annots.map((a) =>
      addObj([
        `<< /Type /Annot /Subtype /Link /Border [0 0 0] ` +
          `/Rect [${a.rect.map(num).join(' ')}] ` +
          `/A << /S /URI /URI (${pdfString(a.url)}) >> >>`,
      ])
    );
    let pageDict =
      `<< /Type /Page /Parent ${pagesId} 0 R /MediaBox [0 0 ${num(PAGE_W)} ${num(PAGE_H)}] ` +
      `/Resources ${resourcesId} 0 R /Contents ${contentId} 0 R`;
    if (annotIds.length) pageDict += ` /Annots [${annotIds.map((i) => `${i} 0 R`).join(' ')}]`;
    pageDict += ' >>';
    pageIds.push(addObj([pageDict]));
  }

  addObj([
    `<< /Type /Pages /Kids [${pageIds.map((i) => `${i} 0 R`).join(' ')}] /Count ${pageIds.length} >>`,
  ]); // = pagesId
  const catalogId = addObj([`<< /Type /Catalog /Pages ${pagesId} 0 R /Lang (fr-FR) >>`]);

  const d = new Date();
  const pad = (v) => String(v).padStart(2, '0');
  const date = `D:${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`;
  const infoId = addObj([
    `<< /Title (${pdfString(meta.title)}) /Author (${pdfString(meta.author)}) ` +
      `/Producer (Editeur de CV) /CreationDate (${date}) >>`,
  ]);

  // Sérialisation avec calcul des offsets pour la table xref
  const chunks = [latin1Bytes('%PDF-1.4\n%âãÏÓ\n')];
  let offset = chunks[0].length;
  const offsets = [];
  objects.forEach((parts, i) => {
    offsets.push(offset);
    const head = latin1Bytes(`${i + 1} 0 obj\n`);
    chunks.push(head);
    offset += head.length;
    for (const part of parts) {
      const bytes = typeof part === 'string' ? latin1Bytes(part) : part;
      chunks.push(bytes);
      offset += bytes.length;
    }
    const tail = latin1Bytes('\nendobj\n');
    chunks.push(tail);
    offset += tail.length;
  });

  let xref = `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (const o of offsets) xref += `${String(o).padStart(10, '0')} 00000 n \n`;
  xref +=
    `trailer\n<< /Size ${objects.length + 1} /Root ${catalogId} 0 R /Info ${infoId} 0 R >>\n` +
    `startxref\n${offset}\n%%EOF\n`;
  chunks.push(latin1Bytes(xref));

  return new Blob(chunks, { type: 'application/pdf' });
}

/* ============================================================
   Point d'entrée
   ============================================================ */

async function generateCvPdf(state) {
  const photo = state.profile.photo ? await preparePhoto(state.profile.photo) : null;
  const doc = makeDoc(state);
  // Après l'await : le rendu qui suit est synchrone, LINE reste cohérent.
  LINE = state.template === 'design' ? LINE_DESIGN : LINE_PRO;
  if (state.template === 'design') renderDesign(doc, state, photo);
  else renderPro(doc, state, photo);
  return buildFile(doc, photo, {
    title: `CV — ${state.profile.name || 'Sans nom'}`,
    author: state.profile.name || '',
  });
}

window.generateCvPdf = generateCvPdf;
// Partagé avec app.js : même dérivation de couleurs à l'écran et dans le PDF
window.cvSidePalette = cvSidePalette;
window.CV_SIDE_BG_DEFAULT = SIDE_BG_DEFAULT;
window.CV_FONT_ROLES = FONT_ROLES;
window.CV_FONT_BOUNDS = { min: FS_MIN, max: FS_MAX };
window.cvFontSizes = cvFontSizes;
window.cvClampFontSize = clampFontSize;

})();
