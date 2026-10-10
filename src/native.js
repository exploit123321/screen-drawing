'use strict';
// Optional Windows API access through koffi. Without it the app works the same, minus the extras that use it.
let koffi = null;
if (process.platform === 'win32') { try { koffi = require('koffi'); } catch { /* not available */ } }

const hwndOf = (win) => { const b = win.getNativeWindowHandle(); return b.length >= 8 ? b.readBigUInt64LE(0) : BigInt(b.readUInt32LE(0)); };

let setAttribute = null;
// Windows fades a window in over ~200 ms every time it is shown, which made the overlay feel slow to open.
function disableShowAnimation(win) {
  if (!koffi) return;
  try {
    setAttribute = setAttribute || koffi.load('dwmapi.dll')
      .func('int32_t __stdcall DwmSetWindowAttribute(intptr_t hwnd, uint32_t attr, _In_ int32_t *value, uint32_t size)');
    setAttribute(hwndOf(win), 3 /* DWMWA_TRANSITIONS_FORCEDISABLED */, [1], 4);
  } catch { /* keep the animation */ }
}

module.exports = { koffi, disableShowAnimation };
