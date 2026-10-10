const $ = (id) => document.getElementById(id);
const NAMED = { Space: 'Space', Enter: 'Return', Tab: 'Tab', ArrowUp: 'Up', ArrowDown: 'Down', ArrowLeft: 'Left', ArrowRight: 'Right',
  PrintScreen: 'PrintScreen', Insert: 'Insert', Delete: 'Delete', Home: 'Home', End: 'End', PageUp: 'PageUp', PageDown: 'PageDown' };
const KEYS = ['drawKey', 'captureKey', 'clickThroughKey'];

function accel(e) {
  let key = null;
  if (/^Key[A-Z]$/.test(e.code)) key = e.code.slice(3);
  else if (/^Digit\d$/.test(e.code)) key = e.code.slice(5);
  else if (/^F\d{1,2}$/.test(e.code)) key = e.code;
  else if (NAMED[e.code]) key = NAMED[e.code];
  if (!key) return null;
  const mods = [e.ctrlKey && 'Ctrl', e.altKey && 'Alt', e.shiftKey && 'Shift', e.metaKey && 'Super'].filter(Boolean);
  if (!mods.length && !/^F\d/.test(key) && key !== 'PrintScreen') return null;   // avoid hijacking plain keys
  return [...mods, key].join('+');
}

for (const id of KEYS) {
  $(id).addEventListener('keydown', (e) => {
    e.preventDefault();
    if (e.key === 'Backspace') { $(id).value = ''; return; }
    const a = accel(e); if (a) $(id).value = a;
  });
}

api.getSettings().then((s) => {
  for (const id of KEYS) $(id).value = s[id] || '';
  $('autoStart').checked = s.autoStart;
});
$('saveBtn').onclick = async () => {
  const keys = KEYS.map((id) => $(id).value).filter(Boolean);
  const msg = $('msg');
  if (new Set(keys).size !== keys.length) { msg.style.color = '#ff6b6b'; msg.textContent = 'Shortcuts must be different.'; return; }
  const r = await api.setSettings({ drawKey: $('drawKey').value, captureKey: $('captureKey').value,
    clickThroughKey: $('clickThroughKey').value, autoStart: $('autoStart').checked });
  msg.style.color = r.failed.length ? '#ff6b6b' : '#34c759';
  msg.textContent = r.failed.length ? 'In use by another app: ' + r.failed.join(', ') : 'Saved';
};
