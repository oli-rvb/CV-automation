const startBtn = document.getElementById('start');
const stopBtn = document.getElementById('stop');
const sendBtn = document.getElementById('send');
const statusEl = document.getElementById('status');
const countsEl = document.getElementById('counts');
const maxPagesEl = document.getElementById('maxPages');

let tab = null;
const onWttj = () => Boolean(tab && /^https:\/\/www\.welcometothejungle\.com\//.test(tab.url || ''));
const clampPages = (v) => Math.min(30, Math.max(1, Number(v) || 5));

function show(status) {
  statusEl.textContent = status.message;
  statusEl.classList.toggle('error', status.phase === 'error');
  startBtn.disabled = status.running || !onWttj();
  stopBtn.disabled = !status.running;
  sendBtn.disabled = status.running || !status.hasJobs;

  const parts = [];
  if (status.pages) parts.push(`${status.pages} page${status.pages > 1 ? 's' : ''} parcourue${status.pages > 1 ? 's' : ''}`);
  if (status.foundCount) parts.push(`${status.foundCount} offres trouvées`);
  if (status.readCount || status.unreadCount) parts.push(`${status.readCount || 0} lues / ${status.unreadCount || 0} non lues`);
  countsEl.textContent = parts.join(' — ');
}

chrome.runtime.onMessage.addListener((msg) => msg.type === 'status' && show(msg.status));

// Nombre de pages max : mémorisé pour les prochaines collectes.
chrome.storage.local.get('maxPages', (r) => {
  if (r.maxPages) maxPagesEl.value = r.maxPages;
});
maxPagesEl.addEventListener('change', () => {
  maxPagesEl.value = clampPages(maxPagesEl.value);
  chrome.storage.local.set({ maxPages: Number(maxPagesEl.value) });
});

startBtn.addEventListener('click', async () => {
  const maxPages = clampPages(maxPagesEl.value);
  maxPagesEl.value = maxPages;
  chrome.storage.local.set({ maxPages });
  const { status } = await chrome.runtime.sendMessage({ type: 'start', tabId: tab.id, maxPages });
  show({ ...status, running: true, message: 'Démarrage…' });
});

stopBtn.addEventListener('click', () => {
  chrome.runtime.sendMessage({ type: 'stop' });
  statusEl.textContent = 'Arrêt demandé : envoi des offres déjà lues…';
});

sendBtn.addEventListener('click', async () => {
  sendBtn.disabled = true;
  const { status } = await chrome.runtime.sendMessage({ type: 'send' });
  show(status);
});

(async () => {
  [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  const { status } = await chrome.runtime.sendMessage({ type: 'get' });
  if (!onWttj() && !status.running) {
    statusEl.textContent = 'Cet onglet n’est pas une page Welcome to the Jungle.';
    startBtn.disabled = true;
    sendBtn.disabled = status.running || !status.hasJobs;
    return;
  }
  show(status);
})();
