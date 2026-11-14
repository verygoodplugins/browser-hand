function extensionState(enabled) {
  document.getElementById('extension').textContent = enabled
    ? 'Browser Hand is enabled. Check its website permissions in Safari Settings.'
    : 'Enable Browser Hand and allow access to the websites you choose.';
}
function setupResult(ok, message) {
  const status = document.getElementById('status');
  status.textContent = message;
  status.className = ok ? 'status success' : 'status error';
  document.getElementById('setup').disabled = false;
}
document.getElementById('setup').addEventListener('click', () => {
  document.getElementById('setup').disabled = true;
  document.getElementById('status').textContent = 'Setting up…';
  webkit.messageHandlers.controller.postMessage('setup');
});
document.getElementById('preferences').addEventListener('click', () => webkit.messageHandlers.controller.postMessage('preferences'));
