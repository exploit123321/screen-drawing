'use strict';
// Lets the mouse wheel scroll the window under the drawing overlay. A low-level mouse hook sees each wheel event
// before Windows picks its target window, makes the overlays click-through for it, and makes them solid again on the
// next mouse button press or once the mouse moves away, so clicks and strokes never fall through.
// Shift+wheel stays with the overlay (it changes the thickness).
// Never call SendInput from here: injecting input on the thread that owns the hook deadlocks Windows input.
let { koffi } = require('./native');

const WH_MOUSE_LL = 14;
const WM_MOUSEMOVE = 0x200, WM_MOUSEWHEEL = 0x20a, WM_MOUSEHWHEEL = 0x20e;
const BUTTON_DOWN = new Set([0x201, 0x204, 0x207, 0x20b]);   // left, right, middle, X
const MOVE_AWAY = 8;                                          // physical px from where the scrolling started

let api = null;
function load() {
  if (api || !koffi) return api;
  try {
    const user32 = koffi.load('user32.dll'), kernel32 = koffi.load('kernel32.dll');
    const HookProc = koffi.proto('intptr_t __stdcall WheelHookProc(int code, uintptr_t msg, void *info)');
    api = {
      POINT: koffi.struct({ x: 'int32_t', y: 'int32_t' }),   // start of MSLLHOOKSTRUCT
      HookProc: koffi.pointer(HookProc),
      SetWindowsHookExW: user32.func('void * __stdcall SetWindowsHookExW(int id, WheelHookProc *proc, void *mod, uint32_t thread)'),
      UnhookWindowsHookEx: user32.func('bool __stdcall UnhookWindowsHookEx(void *hook)'),
      CallNextHookEx: user32.func('intptr_t __stdcall CallNextHookEx(void *hook, int code, uintptr_t msg, void *info)'),
      GetAsyncKeyState: user32.func('int16_t __stdcall GetAsyncKeyState(int key)'),
      GetModuleHandleW: kernel32.func('void * __stdcall GetModuleHandleW(void *name)'),
    };
  } catch { koffi = null; api = null; }
  return api;
}

// windows(): the overlay BrowserWindows that should let the wheel through right now.
function createWheelPassthrough(windows) {
  let hook = null, cb = null, through = false, anchor = null;
  const down = (vk) => (api.GetAsyncKeyState(vk) & 0x8000) !== 0;
  const buttonHeld = () => down(1) || down(2) || down(4);
  const SHIFT = 0x10;
  const setThrough = (on) => {
    through = on;
    for (const w of windows()) if (!w.isDestroyed()) w.setIgnoreMouseEvents(on);
  };

  function proc(code, msg, info) {
    try {
      if (code >= 0) {
        msg = Number(msg);
        if (msg === WM_MOUSEWHEEL || msg === WM_MOUSEHWHEEL) {
          const pass = !down(SHIFT) && !buttonHeld();
          if (pass && !through) { anchor = koffi.decode(info, api.POINT); setThrough(true); }
          else if (!pass && through) setThrough(false);
        } else if (through && BUTTON_DOWN.has(msg)) {
          setThrough(false);
        } else if (through && msg === WM_MOUSEMOVE) {
          const p = koffi.decode(info, api.POINT);
          if (Math.abs(p.x - anchor.x) + Math.abs(p.y - anchor.y) > MOVE_AWAY) setThrough(false);
        }
      }
    } catch { /* never block mouse input */ }
    return api.CallNextHookEx(null, code, msg, info);
  }

  return {
    start() {
      if (hook || !load()) return;
      try {
        cb = koffi.register(proc, api.HookProc);
        hook = api.SetWindowsHookExW(WH_MOUSE_LL, cb, api.GetModuleHandleW(null), 0);
      } catch { hook = null; }
      if (!hook && cb) { koffi.unregister(cb); cb = null; }
    },
    stop() {
      if (!hook) return;
      try { api.UnhookWindowsHookEx(hook); koffi.unregister(cb); } catch { /* already gone */ }
      hook = null; cb = null;
      if (through) setThrough(false);
    },
  };
}

module.exports = { createWheelPassthrough };
