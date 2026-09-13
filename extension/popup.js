const startBtn = document.getElementById('start');
const stopBtn = document.getElementById('stop');
const statusEl = document.getElementById('status');

let tab = null;
const onWttj = () => Boolean(tab && /^https:\/\/www\.welcometothejungle\.com\//.test(tab.url || ''));

function show(status) {
  statusEl.textContent = status.message;
  startBtn.disabled = status.running || !onWttj();
  stopBtn.disabled = !status.running;
}

chrome.runtime.onMessage.addListener((msg) => msg.type === 'status' && show(msg.status));

startBtn.addEventListener('click', async () => {
  const { status } = await chrome.runtime.sendMessage({ type: 'start', tabId: tab.id });
  show({ ...status, running: true, message: 'Démarrage…' });
});

stopBtn.addEventListener('click', () => {
  chrome.runtime.sendMessage({ type: 'stop' });
  statusEl.textContent = 'Arrêt demandé : envoi des offres déjà lues…';
});

(async () => {
  [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  const { status } = await chrome.runtime.sendMessage({ type: 'get' });
  if (!onWttj() && !status.running) {
    statusEl.textContent = 'Cet onglet n’est pas une page Welcome to the Jungle.';
    startBtn.disabled = true;
    return;
  }
  show(status);
})();
