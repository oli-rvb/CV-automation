'use strict';

/* ============================================================
   Backend PDF — Node pur, sans dépendance npm

   Rôle : produire un PDF strictement identique au rendu écran.
   Le CV affiché et le PDF sont mis en page par le MÊME moteur
   (Chromium) : mêmes polices, mêmes retours à la ligne, mêmes
   marges. Le texte reste vectoriel et sélectionnable, donc
   lisible par les ATS.

   - Sert aussi l'application (http://localhost:3333) ;
   - POST /pdf { html } : reçoit le HTML de la feuille CV,
     le compose avec styles.css puis appelle Chrome headless
     (--print-to-pdf) et renvoie le PDF ;
   - POST /fetch-job { url } : rapatrie le HTML d'une offre
     d'emploi (le navigateur ne peut pas le faire lui-même,
     bloqué par le CORS des sites) — l'extraction du texte de
     l'offre reste côté client (app.js) ;
   - POST /rewrite { prompt } : OPTIONNEL. Relaie le prompt de
     recalibrage vers l'API Anthropic, uniquement si la variable
     d'environnement ANTHROPIC_API_KEY est définie. Aucune clé
     n'est lue ailleurs (ni dans le dépôt, ni depuis le client),
     et sans clé le point d'entrée se déclare simplement
     indisponible : l'app retombe alors sur le copier-coller,
     qui reste le mode par défaut du projet.

   Lancement :  node server.js   (port 3333 par défaut)
   ============================================================ */

const http = require('http');
const fs = require('fs');
const os = require('os');
const net = require('net');
const path = require('path');
const dns = require('dns').promises;
const { spawn } = require('child_process');

const PORT = Number(process.env.PORT) || 3333;

/* ---------- Recalibrage des lignes par l'API Anthropic (optionnel) ---------- */

// La clé ne vient QUE de l'environnement. Absente, tout ce bloc reste inerte.
const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY || '';
const ANTHROPIC_MODEL = process.env.ANTHROPIC_MODEL || 'claude-opus-5';
const ANTHROPIC_URL = 'https://api.anthropic.com/v1/messages';
const MAX_PROMPT = 200 * 1024;

const ROOT = __dirname;
const MAX_BODY = 15 * 1024 * 1024; // photo en data-URL incluse

/* ---------- Détection du navigateur Chromium ---------- */

const CHROME_CANDIDATES = {
  darwin: [
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    '/Applications/Chromium.app/Contents/MacOS/Chromium',
    '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
    '/Applications/Brave Browser.app/Contents/MacOS/Brave Browser',
    '/Applications/Arc.app/Contents/MacOS/Arc',
  ],
  linux: [
    '/usr/bin/google-chrome',
    '/usr/bin/chromium',
    '/usr/bin/chromium-browser',
    '/usr/bin/microsoft-edge',
  ],
  win32: [
    'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  ],
};

function findChrome() {
  if (process.env.CHROME_PATH && fs.existsSync(process.env.CHROME_PATH)) {
    return process.env.CHROME_PATH;
  }
  for (const p of CHROME_CANDIDATES[process.platform] || []) {
    if (fs.existsSync(p)) return p;
  }
  return null;
}

const CHROME = findChrome();

/* ---------- Composition de la page à imprimer ---------- */

function buildPrintPage(cvHtml) {
  // fonts.css EN PREMIER, comme dans index.html : il porte le @font-face
  // d'Open Sans en data-URI. Sans lui, Chrome imprimerait la feuille avec la
  // police de repli — retours à la ligne différents de l'écran. Le data-URI
  // est indispensable ici : la page imprimée vit dans un dossier temporaire,
  // où aucun chemin relatif du projet ne résout.
  const fonts = fs.readFileSync(path.join(ROOT, 'fonts.css'), 'utf8');
  const css = fs.readFileSync(path.join(ROOT, 'styles.css'), 'utf8');
  // Même structure que l'app (main > .sheet) pour que les règles
  // écran ET @media print s'appliquent à l'identique.
  return (
    '<!doctype html>\n<html lang="fr">\n<head>\n<meta charset="utf-8">\n' +
    `<style>\n${fonts}\n${css}\n</style>\n</head>\n<body>\n<main>${cvHtml}</main>\n</body>\n</html>\n`
  );
}

/* ---------- Impression via Chrome headless ---------- */

function printToPdf(cvHtml) {
  return new Promise((resolve, reject) => {
    if (!CHROME) {
      reject(new Error('Aucun navigateur Chromium trouvé (définissez CHROME_PATH).'));
      return;
    }
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cv-pdf-'));
    const htmlFile = path.join(dir, 'cv.html');
    const pdfFile = path.join(dir, 'cv.pdf');
    fs.writeFileSync(htmlFile, buildPrintPage(cvHtml));

    const args = [
      '--headless',
      '--disable-gpu',
      '--no-first-run',
      '--no-default-browser-check',
      '--disable-extensions',
      // Profil jetable : n'interfère pas avec un Chrome déjà ouvert
      `--user-data-dir=${path.join(dir, 'profile')}`,
      '--no-pdf-header-footer',
      `--print-to-pdf=${pdfFile}`,
      'file://' + htmlFile,
    ];

    // Chrome écrit le PDF en quelques centaines de millisecondes mais, selon
    // les versions, le processus headless ne se termine jamais : on surveille
    // donc l'apparition du fichier (taille stable sur deux relevés) puis on
    // tue Chrome nous-mêmes au lieu d'attendre sa fin.
    const proc = spawn(CHROME, args, { stdio: 'ignore' });
    let lastSize = -1;
    let done = false;

    const finish = (pdf, err) => {
      if (done) return;
      done = true;
      clearInterval(poll);
      clearTimeout(guard);
      try {
        proc.kill('SIGKILL');
      } catch {
        /* déjà terminé */
      }
      fs.rmSync(dir, { recursive: true, force: true });
      if (pdf && pdf.length > 0) resolve(pdf);
      else reject(err || new Error('Chrome n’a pas produit de PDF.'));
    };

    const poll = setInterval(() => {
      let size = -1;
      try {
        size = fs.statSync(pdfFile).size;
      } catch {
        return; // pas encore écrit
      }
      if (size > 0 && size === lastSize) finish(fs.readFileSync(pdfFile));
      lastSize = size;
    }, 150);

    const guard = setTimeout(() => finish(null, new Error('Délai dépassé (30 s).')), 30000);
    proc.on('error', (err) => finish(null, err));
    proc.on('exit', () => {
      // Sortie normale : lire le résultat sans attendre le prochain relevé
      try {
        finish(fs.readFileSync(pdfFile));
      } catch (err) {
        finish(null, err);
      }
    });
  });
}

/* ---------- Récupération d'une offre d'emploi ---------- */

// Taille maximale de page conservée : au-delà, le début suffit largement
// (les données utiles — JSON-LD, description — sont en tête de document).
const MAX_JOB_HTML = 2 * 1024 * 1024;
const MAX_REDIRECTS = 5;

// Adresses que /fetch-job ne doit jamais atteindre : boucle locale, réseaux
// privés, lien local (dont les métadonnées cloud en 169.254.169.254). Sans ce
// filtre, une page web malveillante pourrait se servir du serveur comme proxy
// vers le réseau interne.
function isPrivateIp(ip) {
  if (net.isIP(ip) === 4) {
    const [a, b] = ip.split('.').map(Number);
    return (
      a === 0 || a === 10 || a === 127 ||
      (a === 100 && b >= 64 && b <= 127) ||
      (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168)
    );
  }
  const low = ip.toLowerCase();
  const mapped = low.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/); // IPv4 notée en IPv6
  if (mapped) return isPrivateIp(mapped[1]);
  return (
    low === '::' || low === '::1' ||
    low.startsWith('fc') || low.startsWith('fd') || // fc00::/7 : réseaux privés
    /^fe[89ab]/.test(low) // fe80::/10 : lien local
  );
}

// Vérifie qu'une URL est bien http(s) et que son hôte ne mène à aucune adresse
// privée. L'hôte est résolu ici puis à nouveau par fetch : un DNS qui répond
// différemment entre les deux (rebinding) passerait, risque acceptable pour un
// outil lancé localement.
async function assertPublicUrl(url) {
  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    throw new Error('URL invalide.');
  }
  if (!/^https?:$/.test(parsed.protocol)) throw new Error('URL invalide (http/https attendu).');
  const host = parsed.hostname.replace(/^\[|\]$/g, ''); // IPv6 entre crochets
  let addresses;
  if (net.isIP(host)) {
    addresses = [host];
  } else {
    try {
      addresses = (await dns.lookup(host, { all: true })).map((a) => a.address);
    } catch {
      throw new Error(`hôte introuvable : ${parsed.hostname}`);
    }
  }
  if (addresses.some(isPrivateIp)) throw new Error('adresse locale ou privée refusée.');
  return parsed;
}

// Lit le corps de la réponse en flux et s'arrête à `limit` octets : la page
// n'est jamais chargée entière en mémoire avant d'être tronquée.
async function readBodyCapped(res, limit) {
  if (!res.body) return '';
  const m = /charset=["']?([\w-]+)/i.exec(res.headers.get('content-type') || '');
  let decoder;
  try {
    decoder = new TextDecoder(m ? m[1] : 'utf-8');
  } catch {
    decoder = new TextDecoder();
  }
  const reader = res.body.getReader();
  let text = '';
  let bytes = 0;
  while (bytes < limit) {
    const { done, value } = await reader.read();
    if (done) break;
    bytes += value.length;
    text += decoder.decode(value, { stream: true });
  }
  await reader.cancel().catch(() => {});
  return text + decoder.decode();
}

async function fetchJobPage(url) {
  if (typeof fetch !== 'function') {
    throw new Error('Node 18 ou plus récent requis pour récupérer une offre.');
  }
  const ctrl = new AbortController();
  const guard = setTimeout(() => ctrl.abort(), 15000);
  try {
    // Redirections suivies à la main : chaque destination repasse par le
    // filtre anti-SSRF (un site public peut rediriger vers une adresse interne).
    let current = await assertPublicUrl(url);
    for (let hop = 0; ; hop++) {
      const res = await fetch(current, {
        redirect: 'manual',
        signal: ctrl.signal,
        headers: {
          // Certains sites d'emploi refusent les clients sans identité de navigateur
          'User-Agent':
            'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36',
          'Accept': 'text/html,application/xhtml+xml;q=0.9,*/*;q=0.8',
          'Accept-Language': 'fr-FR,fr;q=0.9,en;q=0.7',
        },
      });
      const location = res.headers.get('location');
      if (res.status >= 300 && res.status < 400 && location) {
        if (res.body) await res.body.cancel().catch(() => {});
        if (hop >= MAX_REDIRECTS) throw new Error('trop de redirections.');
        current = await assertPublicUrl(new URL(location, current).href);
        continue;
      }
      if (!res.ok) throw new Error(`le site a répondu HTTP ${res.status}`);
      return await readBodyCapped(res, MAX_JOB_HTML);
    }
  } finally {
    clearTimeout(guard);
  }
}

// Relaie le prompt de recalibrage tel quel : c'est le même que celui proposé
// à la copie côté client, pour que les deux chemins produisent la même chose.
async function rewriteWithClaude(prompt) {
  if (!ANTHROPIC_API_KEY) throw new Error('ANTHROPIC_API_KEY absente');
  if (typeof fetch !== 'function') throw new Error('Node 18 ou plus récent requis.');

  const ctrl = new AbortController();
  const guard = setTimeout(() => ctrl.abort(), 120000);
  try {
    const res = await fetch(ANTHROPIC_URL, {
      method: 'POST',
      signal: ctrl.signal,
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01',
        // Repli côté serveur : si un classificateur refuse la demande, elle est
        // reprise par un autre modèle au lieu de revenir vide.
        'anthropic-beta': 'server-side-fallback-2026-07-01',
      },
      body: JSON.stringify({
        model: ANTHROPIC_MODEL,
        max_tokens: 8000,
        // Réécrire une dizaine de lignes ne demande pas de longue réflexion.
        output_config: { effort: 'low' },
        fallbacks: 'default',
        messages: [{ role: 'user', content: prompt }],
      }),
    });
    if (!res.ok) {
      const detail = await res.text().catch(() => '');
      throw new Error(`API Anthropic : HTTP ${res.status} ${detail.slice(0, 200)}`);
    }
    const data = await res.json();
    if (data.stop_reason === 'refusal') throw new Error('demande refusée par le modèle');
    const text = (data.content || [])
      .filter((b) => b && b.type === 'text')
      .map((b) => b.text)
      .join('\n')
      .trim();
    if (!text) throw new Error('réponse vide');
    return text;
  } finally {
    clearTimeout(guard);
  }
}

/* ---------- Serveur HTTP ---------- */

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
};

// CORS : seuls le front servi par ce serveur et index.html ouvert en file://
// (Origin « null ») sont admis — un site tiers visité dans le navigateur ne
// peut plus appeler le backend. Nota : « null » couvre le mode file:// mais
// aussi les iframes sandboxées ; retirer cette entrée si le mode file:// ne
// sert pas.
const ALLOWED_ORIGINS = new Set(['null', `http://localhost:${PORT}`, `http://127.0.0.1:${PORT}`]);

function cors(req, res) {
  const origin = req.headers.origin;
  if (origin && ALLOWED_ORIGINS.has(origin)) {
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  }
}

// Lecture d'un corps de requête JSON, plafonnée. Partagée par les trois
// points d'entrée POST, qui la répétaient à l'identique.
function readJsonBody(req, res) {
  return new Promise((resolve, reject) => {
    let body = '';
    let size = 0;
    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > MAX_BODY) {
        res.writeHead(413);
        res.end('Corps trop volumineux');
        req.destroy();
        reject(new Error('corps trop volumineux'));
        return;
      }
      body += chunk;
    });
    req.on('error', reject);
    req.on('end', () => {
      try {
        resolve(JSON.parse(body));
      } catch {
        reject(new Error('JSON invalide'));
      }
    });
  });
}

const server = http.createServer((req, res) => {
  cors(req, res);

  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    res.end();
    return;
  }

  if (req.method === 'POST' && req.url === '/pdf') {
    readJsonBody(req, res)
      .then(async ({ html }) => {
        if (typeof html !== 'string' || !html.trim()) throw new Error('html manquant');
        const pdf = await printToPdf(html);
        res.writeHead(200, { 'Content-Type': 'application/pdf', 'Content-Length': pdf.length });
        res.end(pdf);
      })
      .catch((err) => {
        if (res.headersSent) return;
        console.error('[pdf]', err.message);
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: err.message }));
      });
    return;
  }

  if (req.method === 'POST' && req.url === '/fetch-job') {
    readJsonBody(req, res)
      .then(async ({ url }) => {
        if (typeof url !== 'string' || !url.trim()) throw new Error('url manquante');
        const html = await fetchJobPage(url.trim());
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ html }));
      })
      .catch((err) => {
        if (res.headersSent) return;
        console.error('[fetch-job]', err.message);
        res.writeHead(502, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: err.message }));
      });
    return;
  }

  // Recalibrage des lignes par l'API Anthropic. Sans clé d'environnement, le
  // point d'entrée répond « indisponible » et le front reprend son chemin
  // presse-papiers — l'utilisateur ne voit passer aucune erreur.
  if (req.method === 'POST' && req.url === '/rewrite') {
    if (!ANTHROPIC_API_KEY) {
      res.writeHead(501, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'ANTHROPIC_API_KEY non définie' }));
      return;
    }
    readJsonBody(req, res)
      .then(async ({ prompt }) => {
        if (typeof prompt !== 'string' || !prompt.trim()) throw new Error('prompt manquant');
        if (prompt.length > MAX_PROMPT) throw new Error('prompt trop long');
        const text = await rewriteWithClaude(prompt);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ text }));
      })
      .catch((err) => {
        if (res.headersSent) return;
        console.error('[rewrite]', err.message);
        res.writeHead(502, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: err.message }));
      });
    return;
  }

  if (req.method === 'GET' || req.method === 'HEAD') {
    // Statut du backend (utilisé par le front pour choisir le mode PDF)
    if (req.url === '/status') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true, chrome: Boolean(CHROME), llm: Boolean(ANTHROPIC_API_KEY) }));
      return;
    }
    const urlPath = decodeURIComponent((req.url || '/').split('?')[0]);
    const rel = urlPath === '/' ? 'index.html' : urlPath.replace(/^\/+/, '');
    const file = path.join(ROOT, rel);
    // Pas de sortie du dossier du projet
    if (!file.startsWith(ROOT + path.sep) || !fs.existsSync(file) || !fs.statSync(file).isFile()) {
      res.writeHead(404);
      res.end('Introuvable');
      return;
    }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(file).toLowerCase()] || 'application/octet-stream' });
    res.end(req.method === 'HEAD' ? undefined : fs.readFileSync(file));
    return;
  }

  res.writeHead(405);
  res.end();
});

// Boucle locale uniquement : le serveur n'est pas joignable depuis le réseau.
server.listen(PORT, '127.0.0.1', () => {
  console.log(`Éditeur de CV : http://localhost:${PORT}`);
  console.log(CHROME ? `PDF via ${CHROME}` : 'ATTENTION : aucun Chromium trouvé, le PDF backend est indisponible.');
  console.log(
    ANTHROPIC_API_KEY
      ? `Recalibrage des lignes via l'API Anthropic (${ANTHROPIC_MODEL}).`
      : 'Recalibrage des lignes par copier-coller (définissez ANTHROPIC_API_KEY pour l’automatiser).'
  );
});
