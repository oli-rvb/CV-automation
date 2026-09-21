'use strict';

/* ============================================================
   Génération du PDF « vectoriel » (comme Canva)

   Le PDF est écrit directement, sans bibliothèque : chaque texte
   est un vrai texte PDF (police Open Sans embarquée, comme à l'écran),
   pas une image. Résultat :
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

/* ---------- Couleur des titres du CV ----------
   Trois modes, réglés par l'utilisateur : « bandeau » (même couleur que le
   bandeau), « complement » (teinte opposée du bandeau, défaut) ou « custom »
   (couleur libre). Calcul centralisé ici, exposé à app.js (window.cvTitleColorHex)
   pour un rendu écran/PDF strictement identique. */

// Conversions HSL (tableaux rgb 0-1 ; teinte h dans 0-1).
function rgbToHsl([r, g, b]) {
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  const d = max - min;
  if (!d) return [0, 0, l];
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  let h;
  if (max === r) h = (g - b) / d + (g < b ? 6 : 0);
  else if (max === g) h = (b - r) / d + 2;
  else h = (r - g) / d + 4;
  return [h / 6, s, l];
}

function hslToRgb([h, s, l]) {
  if (s === 0) return [l, l, l];
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
  const p = 2 * l - q;
  const chan = (t) => {
    t = (t % 1 + 1) % 1;
    if (t < 1 / 6) return p + (q - p) * 6 * t;
    if (t < 1 / 2) return q;
    if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
    return p;
  };
  return [chan(h + 1 / 3), chan(h), chan(h - 1 / 3)];
}

// Complémentaire : teinte opposée (+180°), saturation et clarté conservées —
// reste donc aussi lisible que la couleur d'origine sur fond blanc.
function complement(rgb) {
  const [h, s, l] = rgbToHsl(rgb);
  return hslToRgb([(h + 0.5) % 1, s, l]);
}

function cvTitleColorRgb(state) {
  const mode = state && state.titleColorMode;
  if (mode === 'custom') return parseHex(state.titleColor) || C.accent;
  const sideBg = parseHex(state && state.sideColor) || parseHex(SIDE_BG_DEFAULT);
  if (mode === 'bandeau') return sideBg;
  return complement(sideBg); // « complement » par défaut
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
      { key: 'companyDescription', label: 'Description entreprise', def: 7, cssVar: '--fs-company-desc' },
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
      { key: 'companyDescription', label: 'Description entreprise', def: 7, cssVar: '--fs-company-desc' },
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
   Police Open Sans embarquée dans le PDF, et ses métriques

   La police de l'écran (fonts.css) est un WOFF2 variable : le navigateur
   ne permet pas d'en relire les octets, et le décoder à la main
   (Brotli + glyf transformé) coûterait bien plus qu'il ne rapporte. On
   embarque donc ici les deux instances statiques dont le CV a besoin
   (400 et 700), au format TrueType, avec le même jeu de glyphes latin que
   fonts.css (le français y est complet). Chacune est un flux zlib en
   base64, écrit tel quel dans le PDF (/FlateDecode).

   Recette pour les régénérer depuis le WOFF2 de fonts.css (fontTools) :
   instantiateVariableFont(font, {'wght': 400 | 700}), ne garder que les
   tables head hhea maxp hmtx cmap loca glyf, enregistrer en TTF, puis
   zlib.compress. GLYPH_TABLE en est extrait :
   [point de code, identifiant de glyphe, largeur 400, largeur 700], en
   millièmes de cadratin. Les deux instances partagent les mêmes
   identifiants de glyphe.
   ============================================================ */

const GLYPH_TABLE = [
  [32,3,260,260], [33,4,264,286], [34,5,398,472], [35,6,646,646],
  [36,7,572,572], [37,8,827,901], [38,9,729,750], [39,10,219,266], [40,11,295,339], [41,12,295,339],
  [42,13,551,545], [43,14,572,572], [44,15,259,285], [45,16,322,322], [46,17,263,285], [47,18,367,413],
  [48,19,572,572], [49,20,572,572], [50,21,572,572], [51,22,572,572], [52,23,572,572], [53,24,572,572],
  [54,25,572,572], [55,26,572,572], [56,27,572,572], [57,28,572,572], [58,29,263,285], [59,30,263,285],
  [60,31,572,572], [61,32,572,572], [62,33,572,572], [63,34,432,477], [64,35,896,897], [65,36,632,690],
  [66,37,646,672], [67,38,630,637], [68,39,726,740], [69,40,556,560], [70,41,516,549], [71,42,727,724],
  [72,43,737,765], [73,44,279,331], [74,45,269,331], [75,46,612,664], [76,47,522,565], [77,48,899,943],
  [78,49,753,813], [79,50,778,796], [80,51,602,628], [81,52,778,796], [82,53,617,660], [83,54,548,551],
  [84,55,551,579], [85,56,729,756], [86,57,596,650], [87,58,923,967], [88,59,578,667], [89,60,559,624],
  [90,61,572,579], [91,62,327,331], [92,63,367,413], [93,64,327,331], [94,65,572,572], [95,66,438,411],
  [96,67,277,362], [97,68,556,604], [98,69,612,633], [99,70,479,514], [100,71,612,633], [101,72,562,591],
  [102,73,336,387], [103,74,543,565], [104,75,613,657], [105,76,252,305], [106,77,252,305], [107,78,525,620],
  [108,79,252,305], [109,80,926,982], [110,81,613,657], [111,82,602,619], [112,83,612,633], [113,84,612,633],
  [114,85,409,454], [115,86,477,497], [116,87,356,434], [117,88,613,657], [118,89,500,569], [119,90,775,856],
  [120,91,523,578], [121,92,501,569], [122,93,469,488], [123,94,375,394], [124,95,549,551], [125,96,375,394],
  [126,97,572,572], [160,98,260,260], [161,99,264,286], [162,100,572,572], [163,101,572,572], [164,102,572,572],
  [165,103,572,572], [166,104,549,551], [167,105,514,486], [168,106,580,607], [169,107,832,832], [170,108,353,383],
  [171,109,496,615], [172,110,572,572], [173,111,322,322], [174,112,832,832], [175,113,500,500], [176,114,428,428],
  [177,115,572,572], [178,116,348,379], [179,117,348,379], [180,118,277,362], [181,119,618,660], [182,120,655,655],
  [183,121,263,285], [184,122,222,205], [185,123,348,379], [186,124,374,388], [187,125,496,615], [188,126,740,830],
  [189,127,768,874], [190,128,778,845], [191,129,432,477], [192,130,632,690], [193,131,632,690], [194,132,632,690],
  [195,133,632,690], [196,134,632,690], [197,135,632,690], [198,136,868,952], [199,137,630,637], [200,138,556,560],
  [201,139,556,560], [202,140,556,560], [203,141,556,560], [204,142,279,331], [205,143,279,331], [206,144,279,331],
  [207,145,279,331], [208,146,726,740], [209,147,753,813], [210,148,778,796], [211,149,778,796], [212,150,778,796],
  [213,151,778,796], [214,152,778,796], [215,153,572,572], [216,154,778,796], [217,155,729,756], [218,156,729,756],
  [219,157,729,756], [220,158,729,756], [221,159,559,624], [222,160,602,628], [223,161,623,711], [224,162,556,604],
  [225,163,556,604], [226,164,556,604], [227,165,556,604], [228,166,556,604], [229,167,556,604], [230,168,862,917],
  [231,169,479,514], [232,170,562,591], [233,171,562,591], [234,172,562,591], [235,173,562,591], [236,174,252,305],
  [237,175,252,305], [238,176,252,305], [239,177,252,305], [240,178,600,619], [241,179,613,657], [242,180,602,619],
  [243,181,602,619], [244,182,602,619], [245,183,602,619], [246,184,602,619], [247,185,572,572], [248,186,602,619],
  [249,187,613,657], [250,188,613,657], [251,189,613,657], [252,190,613,657], [253,191,501,569], [254,192,612,633],
  [255,193,501,569], [305,241,252,305], [338,196,925,973], [339,197,948,978], [700,230,169,217], [710,198,409,504],
  [730,201,298,325], [732,202,442,485], [768,243,0,0], [769,244,0,0], [771,245,0,0], [772,246,0,0],
  [776,247,0,0], [777,232,0,0], [803,248,0,0], [8194,225,500,500], [8201,226,166,166], [8203,227,0,0],
  [8211,203,500,500], [8212,204,1000,1000], [8216,205,169,217], [8217,206,169,217], [8218,207,245,285], [8220,208,349,445],
  [8221,209,349,445], [8222,210,409,513], [8226,211,376,376], [8230,212,778,855], [8242,213,230,303], [8243,214,403,524],
  [8249,215,300,368], [8250,216,300,368], [8260,217,128,130], [8364,218,572,572], [8482,219,764,773], [8722,220,572,572],
  [8725,279,367,413], [65279,228,0,0], [65533,229,1000,1000],
];

const FONT_REGULAR = {
  name: 'OpenSans-Regular', length1: 21008, bbox: [-488, -242, 960, 945], stemV: 84,
  data: [
    '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',
    'kvaPz/8DNZvMCg==',
  ].join(''),
};

const FONT_BOLD = {
  name: 'OpenSans-Bold', length1: 21068, bbox: [-530, -240, 1008, 934], stemV: 136,
  data: [
    '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',
    '/fxfbu+2Cg==',
  ].join(''),
};

// Métriques verticales communes (millièmes de cadratin, hhea / OS/2)
const FONT_ASCENT = 1069;
const FONT_DESCENT = -293;
const FONT_CAP_HEIGHT = 714;

// Ligne de base d'un texte dans une ligne de hauteur `lineH`, comme en CSS :
// le contenu (ascendante + descendante de la police) est centré verticalement.
const baselineOffset = (size, lineH) =>
  (lineH - ((FONT_ASCENT - FONT_DESCENT) * size) / 1000) / 2 + (FONT_ASCENT * size) / 1000;

const GLYPHS = new Map(GLYPH_TABLE.map(([cp, gid, ...w]) => [cp, { gid, w }]));

// Glyphe d'un caractère : les blancs deviennent une espace, une lettre
// absente de la police (hors latin) retombe sur sa lettre de base, et à
// défaut sur « ? ».
function glyphOf(ch) {
  let code = ch.codePointAt(0);
  if (code === 0x0a || code === 0x0d || code === 0x09) code = 0x20;
  const glyph = GLYPHS.get(code);
  if (glyph) return glyph;
  const base = ch.normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  return GLYPHS.get(base ? base.codePointAt(0) : 63) || GLYPHS.get(63);
}

const glyphWidth = (ch, bold) => glyphOf(ch).w[bold ? 1 : 0];

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
   Chaînes PDF des métadonnées et des liens : octets WinAnsi (CP1252)
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

// Texte affiché : un identifiant de glyphe sur 2 octets par caractère
// (encodage Identity-H), en hexadécimal.
function glyphHex(text) {
  let out = '';
  for (const ch of text) out += glyphOf(ch).gid.toString(16).padStart(4, '0');
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
  op += `${num(x)} ${num(PAGE_H - yBaseline)} Td <${glyphHex(text)}> Tj`;
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
    const baseline = col.y + baselineOffset(baseSize, lineH);
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
  opText(col.page(), col.x, col.y + baselineOffset(size, size * LINE), text.toUpperCase(), {
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
  col.ensure(2 * PX + lineH); // au moins la première ligne avec la puce
  col.y += 2 * PX;
  opText(col.page(), col.x + 2, col.y + baselineOffset(size, lineH), '•', { size, color: dotColor });
  // Les sauts de ligne manuels (Maj+Entrée) sont dessinés paragraphe par
  // paragraphe : wrapSegments traiterait sinon un `\n` comme un simple espace.
  for (const para of text.split('\n')) {
    const lines = wrapSegments([{ text: para, bold: false, size, color }], col.width - indent, col.width - indent);
    drawLines(col, lines, { lineH, indent });
  }
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
  const {
    role = 15, company: companySize = 14, period: periodPx = 13,
    companyDescription: descPx = 7, bullet = 14, gap = 14,
  } = sizes;
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
    opText(headPage, col.x + col.width - periodW, headY + baselineOffset(roleSize, lineH), period, {
      size: periodSize, color: palette.muted,
    });
  }

  col.y += 4.5; // marge avant la description / les tirets

  // Description de l'entreprise : petite et grise, sous l'en-tête. Sa taille
  // est réglable comme les autres (section « Taille des textes »).
  const desc = (exp.companyDescription || '').trim();
  if (desc) {
    const descSize = descPx * PX;
    // Sauts de ligne manuels (Maj+Entrée) : un wrapSegments par paragraphe,
    // sinon `\n` serait traité comme un simple espace.
    for (const para of desc.split('\n')) {
      const descLines = wrapSegments([{ text: para, bold: false, size: descSize, color: palette.muted }], col.width, col.width);
      drawLines(col, descLines, { lineH: descSize * LINE });
    }
    col.y += 4.5;
  }

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
  const titleC = cvTitleColorRgb(state); // couleur des titres selon le mode choisi
  const f = cvFontSizes(state.fontSizes && state.fontSizes.pro, 'pro').main;

  const photoSize = 110 * PX;
  if (photo) col.width = contentW - photoSize - 24 * PX;

  paragraph(col, state.profile.name, { bold: true, size: f.name * PX, color: C.ink }, { lineH: f.name * PX * 1.2 });
  col.y += 2 * PX;
  paragraph(col, state.profile.title, { bold: true, size: f.title * PX, color: titleC });
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
  for (const line of (state.profile.summary || '').split('\n')) {
    paragraph(col, line, { size: f.summary * PX, color: C.ink });
  }
  col.y += 10 * PX; // air supplémentaire avant le premier titre de section (cf. styles.css)

  const st = { size: f.section * PX, color: titleC, ruleColor: titleC, mt: 26 * PX, mb: 10 * PX };
  const expSizes = {
    role: f.item, company: f.detail, period: f.period,
    companyDescription: f.companyDescription, bullet: f.bullet, gap: 14,
  };
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
  const titleC = cvTitleColorRgb(state); // couleur des titres selon le mode choisi
  const stMain = { size: fm.section * PX, color: titleC, ruleColor: titleC, mt: 14 * PX, mb: 6 * PX };
  const expSizes = {
    role: fm.item, company: fm.detail, period: fm.period,
    companyDescription: fm.companyDescription, bullet: fm.bullet, gap: 8,
  };
  const subSizes = { title: fm.item, detail: fm.detail, bullet: fm.bullet, gap: 8 };

  paragraph(main, state.profile.title, { bold: true, size: fm.title * PX, color: titleC });
  main.y += 8 * PX;
  for (const line of (state.profile.summary || '').split('\n')) {
    paragraph(main, line, { size: fm.summary * PX, color: C.ink });
  }
  main.y += 10 * PX; // air supplémentaire avant le premier titre de section (cf. styles.css)

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
      resolve({ bytes: base64Bytes(jpeg.split(',')[1]), w: size, h: size });
    };
    img.onerror = () => resolve(null); // photo illisible : PDF sans photo
    img.src = dataUrl;
  });
}

/* ============================================================
   Assemblage du fichier PDF (objets, xref, trailer)
   ============================================================ */

function base64Bytes(b64) {
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}

function latin1Bytes(str) {
  const b = new Uint8Array(str.length);
  for (let i = 0; i < str.length; i++) b[i] = str.charCodeAt(i) & 0xff;
  return b;
}

// Table ToUnicode commune aux deux graisses (mêmes identifiants de glyphe) :
// c'est elle qui rend le texte sélectionnable et copiable. Quand plusieurs
// caractères partagent un glyphe (espace insécable…), le premier l'emporte.
function toUnicodeCMap() {
  const hex4 = (n) => n.toString(16).padStart(4, '0');
  const byGid = new Map();
  for (const [cp, gid] of GLYPH_TABLE) if (!byGid.has(gid)) byGid.set(gid, cp);
  const entries = [...byGid].map(([gid, cp]) => `<${hex4(gid)}> <${hex4(cp)}>`);
  let body = '';
  for (let i = 0; i < entries.length; i += 100) { // 100 entrées max par bloc
    const chunk = entries.slice(i, i + 100);
    body += `${chunk.length} beginbfchar\n${chunk.join('\n')}\nendbfchar\n`;
  }
  return (
    '/CIDInit /ProcSet findresource begin\n12 dict begin\nbegincmap\n' +
    '/CIDSystemInfo << /Registry (Adobe) /Ordering (UCS) /Supplement 0 >> def\n' +
    '/CMapName /Adobe-Identity-UCS def\n/CMapType 2 def\n' +
    `1 begincodespacerange\n<0000> <FFFF>\nendcodespacerange\n${body}` +
    'endcmap\nCMapName currentdict /CMap defineresource pop\nend\nend'
  );
}

// Police TrueType embarquée en Type0 / CIDFontType2 (Identity-H) ;
// renvoie l'id de l'objet police. `bold` choisit la colonne de largeurs.
function addFont(addObj, font, bold, toUnicodeId) {
  const data = base64Bytes(font.data);
  const fileId = addObj([
    `<< /Length ${data.length} /Length1 ${font.length1} /Filter /FlateDecode >>\nstream\n`,
    data,
    '\nendstream',
  ]);
  const [x0, y0, x1, y1] = font.bbox;
  const descriptorId = addObj([
    `<< /Type /FontDescriptor /FontName /${font.name} /Flags 32 /FontBBox [${x0} ${y0} ${x1} ${y1}] ` +
      `/ItalicAngle 0 /Ascent ${FONT_ASCENT} /Descent ${FONT_DESCENT} /CapHeight ${FONT_CAP_HEIGHT} ` +
      `/StemV ${font.stemV} /FontFile2 ${fileId} 0 R >>`,
  ]);
  // Largeurs (millièmes de cadratin) indexées par identifiant de glyphe
  const widths = [];
  for (const [, gid, ...w] of GLYPH_TABLE) widths[gid] = w[bold ? 1 : 0];
  const cidId = addObj([
    `<< /Type /Font /Subtype /CIDFontType2 /BaseFont /${font.name} ` +
      `/CIDSystemInfo << /Registry (Adobe) /Ordering (Identity) /Supplement 0 >> ` +
      `/FontDescriptor ${descriptorId} 0 R /CIDToGIDMap /Identity /DW 0 ` +
      `/W [0 [${Array.from(widths, (v) => v || 0).join(' ')}]] >>`,
  ]);
  return addObj([
    `<< /Type /Font /Subtype /Type0 /BaseFont /${font.name} /Encoding /Identity-H ` +
      `/DescendantFonts [${cidId} 0 R] /ToUnicode ${toUnicodeId} 0 R >>`,
  ]);
}

function buildFile(doc, photo, meta) {
  const objects = []; // chaque objet : tableau de morceaux (string | Uint8Array)
  const addObj = (parts) => objects.push(parts) - 1 + 1; // ids à partir de 1

  const cmapBytes = latin1Bytes(toUnicodeCMap());
  const toUnicodeId = addObj([`<< /Length ${cmapBytes.length} >>\nstream\n`, cmapBytes, '\nendstream']);
  const fontRegId = addFont(addObj, FONT_REGULAR, false, toUnicodeId);
  const fontBoldId = addFont(addObj, FONT_BOLD, true, toUnicodeId);

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

async function generateCvPdf(state, title) {
  const photo = state.profile.photo ? await preparePhoto(state.profile.photo) : null;
  const doc = makeDoc(state);
  // Après l'await : le rendu qui suit est synchrone, LINE reste cohérent.
  LINE = state.template === 'design' ? LINE_DESIGN : LINE_PRO;
  if (state.template === 'design') renderDesign(doc, state, photo);
  else renderPro(doc, state, photo);
  return buildFile(doc, photo, {
    title: title || `CV — ${state.profile.name || 'Sans nom'}`,
    author: state.profile.name || '',
  });
}

window.generateCvPdf = generateCvPdf;
// Partagé avec app.js : même dérivation de couleurs à l'écran et dans le PDF
window.cvSidePalette = cvSidePalette;
window.cvTitleColorHex = (state) => toHex(cvTitleColorRgb(state));
window.CV_SIDE_BG_DEFAULT = SIDE_BG_DEFAULT;
window.CV_FONT_ROLES = FONT_ROLES;
window.CV_FONT_BOUNDS = { min: FS_MIN, max: FS_MAX };
window.cvFontSizes = cvFontSizes;
window.cvClampFontSize = clampFontSize;

})();
