'use strict';
const $ = (s) => document.querySelector(s);
const $$ = (s) => [...document.querySelectorAll(s)];
const bg = $('#bg'), shade = $('#shade'), ink = $('#ink');
const shx = shade.getContext('2d'), inx = ink.getContext('2d');
const toolbar = $('#toolbar'), dimsEl = $('#dims'), modebar = $('#modebar');
const COLORS = ['#ff3b30', '#ff9500', '#ffd60a', '#34c759', '#0a84ff', '#af52de', '#ffffff', '#000000'];

let cfg, dpr = 1, W = 0, H = 0;
let tool = { tool: 'pen', color: '#ff3b30', color2: '#0a84ff', width: 4 };   // color: left button, color2: right
let stage = 'draw';                    // draw | select | annotate
let selKind = 'region';                // region | free | full
let sel = null, freePts = null, dragStart = null;
let shapes = [], redo = [], cur = null, editing = null;
let ct = false, lastOver = null, bgReady = false, bgWaiters = null;
let drawSnap = null;                   // drawings to bring back after a capture started from drawing mode
let finishTimer = 0;
// Finished shapes are drawn once onto this offscreen canvas; render() then only adds the shape being drawn,
// so drawing stays smooth however much is already on screen.
const done = document.createElement('canvas'), dnx = done.getContext('2d');
let doneN = 0;                         // shapes[0..doneN) are on `done`; set to -1 after anything but an append

/* ---------- init ---------- */
function resetState() {
  if (editing) { editing.ta.remove(); editing = null; }
  clearTimeout(finishTimer); document.body.classList.remove('finished');
  bgReady = false; shapes = []; redo = []; doneN = -1; cur = null; sel = null; freePts = null; dragStart = null; drawSnap = null;
  ct = false; lastOver = null; $('#through').classList.remove('active'); document.body.classList.remove('ct');
  toolbar.hidden = true; modebar.hidden = true; dimsEl.hidden = true; $('#toast').hidden = true; $('#sizering').hidden = true;
  for (const c of [bg, shade, ink]) c.getContext('2d').clearRect(0, 0, c.width, c.height);
  document.body.dataset.mode = ''; setStage('draw');
}
api.onReset(resetState);

api.onInit(async (d) => {
  resetState();
  cfg = d; dpr = d.display.scaleFactor; W = d.display.bounds.width; H = d.display.bounds.height;
  for (const c of [bg, shade, ink, done]) {
    if (c.width !== Math.round(W * dpr)) c.width = Math.round(W * dpr);
    if (c.height !== Math.round(H * dpr)) c.height = Math.round(H * dpr);
    if (c !== done) { c.style.width = W + 'px'; c.style.height = H + 'px'; }
  }
  doneN = -1;
  tool = d.tool; syncToolUI();
  if (d.ctKey) $('#through').dataset.tip = `Click-through: use windows underneath (${d.ctKey})`;
  document.body.dataset.mode = d.mode;

  if (d.mode === 'draw') {
    setStage('draw');
    if (d.toolbar) { toolbar.hidden = false; placeToolbar(W / 2 - 322, 24); }
  } else startCapture(d.kind);
  drawShade(); render();
  requestAnimationFrame(() => api.ready());
});
// Switch an open drawing overlay (shapes kept) into capture mode, remembering the drawings for afterwards.
api.onCaptureMode((d) => {
  clearTimeout(finishTimer); document.body.classList.remove('finished'); $('#toast').hidden = true;
  commitText();
  if (document.body.dataset.mode === 'draw') {
    drawSnap = { shapes: shapes.slice(), redo: redo.slice(), bar: toolbar.hidden ? null : { x: toolbar.offsetLeft, y: toolbar.offsetTop } };
  }
  startCapture(d.kind); drawShade(); render();
});
// Capture finished or cancelled: back to the drawings as they were (annotations made in the capture are dropped).
api.onDrawMode(() => {
  if (editing) { editing.ta.remove(); editing = null; }
  const s = drawSnap || { shapes: [], redo: [], bar: null }; drawSnap = null;
  shapes = s.shapes; redo = s.redo; doneN = -1; cur = null; sel = null; freePts = null; dragStart = null;
  bgReady = false; bg.getContext('2d').clearRect(0, 0, bg.width, bg.height);
  document.body.dataset.mode = 'draw'; setStage('draw');
  modebar.hidden = true; dimsEl.hidden = true;
  toolbar.hidden = !s.bar; if (s.bar) placeToolbar(s.bar.x, s.bar.y);
  drawShade(); render();
});
api.onClickThrough((on) => {
  ct = on; lastOver = null;
  $('#through').classList.toggle('active', on); document.body.classList.toggle('ct', on);
});
api.onBg((s) => {
  const bx = bg.getContext('2d'); bx.clearRect(0, 0, bg.width, bg.height);
  try {
    // The screen grab is BGRA; VideoFrame takes it as is, without a slow per-pixel swap in JavaScript.
    const f = new VideoFrame(s.data, { format: 'BGRA', codedWidth: s.w, codedHeight: s.h, timestamp: 0 });
    bx.drawImage(f, 0, 0, bg.width, bg.height); f.close();
  } catch {
    const u = new Uint32Array(s.data.buffer, s.data.byteOffset, s.data.byteLength >> 2);
    for (let i = 0; i < u.length; i++) { const v = u[i]; u[i] = (v & 0xff00ff00) | ((v & 0xff) << 16) | ((v >> 16) & 0xff); }  // BGRA -> RGBA
    const img = new ImageData(new Uint8ClampedArray(s.data.buffer, s.data.byteOffset, s.data.byteLength), s.w, s.h);
    if (s.w === bg.width && s.h === bg.height) bx.putImageData(img, 0, 0);
    else { const tmp = document.createElement('canvas'); tmp.width = s.w; tmp.height = s.h; tmp.getContext('2d').putImageData(img, 0, 0); bx.drawImage(tmp, 0, 0, bg.width, bg.height); }
  }
  bgReady = true; if (bgWaiters) { bgWaiters(); bgWaiters = null; }
});
function startCapture(kind) {
  document.body.dataset.mode = 'capture';
  ct = false; document.body.classList.remove('ct'); $('#through').classList.remove('active');
  if (kind === 'full') { sel = { x: 0, y: 0, w: W, h: H }; selKind = 'full'; freePts = null; enterAnnotate(); }
  else { selKind = kind === 'free' ? 'free' : 'region'; sel = null; freePts = null; setStage('select'); toolbar.hidden = true; modebar.hidden = false; updateModebar(); }
}
api.onTool((s) => { tool = s; syncToolUI(); });
window.__getInk = () => (activeShapes().length ? ink.toDataURL('image/png') : null);

function setStage(s) { stage = s; document.body.dataset.stage = s; }

/* ---------- toolbar UI ---------- */
COLORS.forEach((c) => { const i = document.createElement('i'); i.style.background = c; i.dataset.c = c; $('#colors').append(i); });
function pushTool() { syncToolUI(); api.tool(tool); }
function syncToolUI() {
  $$('[data-tool]').forEach((b) => b.classList.toggle('active', b.dataset.tool === tool.tool));
  $$('#colors i').forEach((i) => {
    i.classList.toggle('on', i.dataset.c === tool.color);
    i.classList.toggle('on2', i.dataset.c === tool.color2 && tool.color2 !== tool.color);
  });
  $('#swatch .c1').style.background = tool.color; $('#swatch .c2').style.background = tool.color2;
  $('#width').value = tool.width;
  const p = $('#wpreview i'); const s = Math.min(28, tool.width + 2);
  p.style.width = p.style.height = s + 'px'; p.style.background = tool.color;
}
const TOOLS = $$('[data-tool]').map((b) => b.dataset.tool);           // toolbar order = number keys 1, 2, 3...
$$('[data-tool]').forEach((b) => b.onclick = () => { commitText(); tool.tool = b.dataset.tool; pushTool(); });
$('#colors').onclick = (e) => { if (e.target.dataset.c) { tool.color = e.target.dataset.c; pushTool(); } };
$('#colors').oncontextmenu = (e) => { e.preventDefault(); if (e.target.dataset.c) { tool.color2 = e.target.dataset.c; pushTool(); } };
$('#swatch').onclick = () => { [tool.color, tool.color2] = [tool.color2, tool.color]; pushTool(); };
// The custom picker edits the primary color on click and the secondary one on right-click.
let customFor = 'color';
$('#custom').onclick = () => { customFor = 'color'; $('#custom').value = tool.color; };
$('.custom').oncontextmenu = (e) => {
  e.preventDefault(); customFor = 'color2'; $('#custom').value = tool.color2;
  try { $('#custom').showPicker(); } catch { /* picker unavailable */ }
};
$('#custom').oninput = (e) => { tool[customFor] = e.target.value; pushTool(); };
$('#width').oninput = (e) => { tool.width = +e.target.value; pushTool(); };
$('#undo').onclick = undo; $('#redo').onclick = redoFn; $('#clear').onclick = clearAll;
$('#close').onclick = () => api.close();
$('#cap-region').onclick = () => api.capture('region');
$('#cap-free').onclick = () => api.capture('free');
$('#cap-full').onclick = () => api.capture('full');
$('#copy').onclick = doCopy; $('#save').onclick = doSave;
$('#through').onclick = () => api.clickThrough(!ct);            // main answers with 'clickthrough' (onClickThrough)
// While click-through, only the toolbar should catch the mouse.
document.addEventListener('mousemove', (e) => {
  if (!ct) return;
  const over = !!e.target.closest('#toolbar');
  if (over !== lastOver) { lastOver = over; api.ignore(!over); }
});

// movable toolbar
(() => {
  const grip = $('#grip'); let off = null;
  grip.addEventListener('pointerdown', (e) => { grip.setPointerCapture(e.pointerId); off = { x: e.clientX - toolbar.offsetLeft, y: e.clientY - toolbar.offsetTop }; });
  grip.addEventListener('pointermove', (e) => { if (off) placeToolbar(e.clientX - off.x, e.clientY - off.y); });
  grip.addEventListener('pointerup', () => { off = null; });
})();
function placeToolbar(x, y) {
  const w = toolbar.offsetWidth || 644, h = toolbar.offsetHeight || 84;
  toolbar.style.left = Math.max(4, Math.min(W - w - 4, x)) + 'px';
  toolbar.style.top = Math.max(4, Math.min(H - h - 4, y)) + 'px';
}

/* ---------- history ---------- */
const activeShapes = () => { let s = 0; shapes.forEach((x, i) => { if (x.type === 'clear') s = i + 1; }); return shapes.slice(s); };
function undo() { commitText(); if (shapes.length) { redo.push(shapes.pop()); doneN = -1; render(); } }
function redoFn() { commitText(); if (redo.length) { shapes.push(redo.pop()); render(); } }
function clearAll() { commitText(); if (activeShapes().length) { shapes.push({ type: 'clear' }); redo = []; render(); } }

/* ---------- drawing ---------- */
function drawShape(c, s) {
  c.save();
  c.lineCap = 'round'; c.lineJoin = 'round'; c.strokeStyle = s.color; c.fillStyle = s.color; c.lineWidth = s.width;
  switch (s.type) {
    case 'pen': strokePath(c, s.pts); break;
    case 'highlighter': c.globalAlpha = .4; c.lineWidth = s.width * 3.5; c.lineCap = 'square'; strokePath(c, s.pts); break;
    case 'eraser': c.globalCompositeOperation = 'destination-out'; c.strokeStyle = c.fillStyle = '#000'; c.lineWidth = s.width * 4; strokePath(c, s.pts); break;
    case 'line': c.beginPath(); c.moveTo(s.a.x, s.a.y); c.lineTo(s.b.x, s.b.y); c.stroke(); break;
    case 'arrow': {
      const ang = Math.atan2(s.b.y - s.a.y, s.b.x - s.a.x), hl = Math.max(14, s.width * 4.5);
      const bx = s.b.x - Math.cos(ang) * hl * .7, by = s.b.y - Math.sin(ang) * hl * .7;
      c.beginPath(); c.moveTo(s.a.x, s.a.y); c.lineTo(bx, by); c.stroke();
      c.beginPath(); c.moveTo(s.b.x, s.b.y);
      c.lineTo(s.b.x - hl * Math.cos(ang - .42), s.b.y - hl * Math.sin(ang - .42));
      c.lineTo(s.b.x - hl * Math.cos(ang + .42), s.b.y - hl * Math.sin(ang + .42));
      c.closePath(); c.fill(); break;
    }
    case 'rect': c.strokeRect(Math.min(s.a.x, s.b.x), Math.min(s.a.y, s.b.y), Math.abs(s.b.x - s.a.x), Math.abs(s.b.y - s.a.y)); break;
    case 'ellipse':
      c.beginPath(); c.ellipse((s.a.x + s.b.x) / 2, (s.a.y + s.b.y) / 2, Math.abs(s.b.x - s.a.x) / 2, Math.abs(s.b.y - s.a.y) / 2, 0, 0, Math.PI * 2); c.stroke(); break;
    case 'text':
      c.font = `600 ${s.size}px "Segoe UI", sans-serif`; c.textBaseline = 'top';
      s.text.split('\n').forEach((ln, i) => c.fillText(ln, s.x + 2, s.y + i * s.size * 1.25)); break;
  }
  c.restore();
}
function strokePath(c, p) {
  if (p.length === 1) { c.beginPath(); c.arc(p[0].x, p[0].y, c.lineWidth / 2, 0, Math.PI * 2); c.fill(); return; }
  c.beginPath(); c.moveTo(p[0].x, p[0].y);
  for (let i = 1; i < p.length - 1; i++) c.quadraticCurveTo(p[i].x, p[i].y, (p[i].x + p[i + 1].x) / 2, (p[i].y + p[i + 1].y) / 2);
  c.lineTo(p[p.length - 1].x, p[p.length - 1].y); c.stroke();
}
// Brings `done` up to date: draws only the shapes added since last time, or everything after an undo or reset.
function syncDone() {
  if (doneN === shapes.length) return;
  let from = doneN;
  if (from < 0 || from > shapes.length) {
    from = 0; shapes.forEach((s, i) => { if (s.type === 'clear') from = i; });
    dnx.setTransform(1, 0, 0, 1, 0, 0); dnx.clearRect(0, 0, done.width, done.height);
  }
  dnx.setTransform(dpr, 0, 0, dpr, 0, 0);
  for (let i = from; i < shapes.length; i++) {
    if (shapes[i].type === 'clear') { dnx.setTransform(1, 0, 0, 1, 0, 0); dnx.clearRect(0, 0, done.width, done.height); dnx.setTransform(dpr, 0, 0, dpr, 0, 0); }
    else drawShape(dnx, shapes[i]);
  }
  doneN = shapes.length;
}
function render() {
  syncDone();
  inx.setTransform(1, 0, 0, 1, 0, 0); inx.clearRect(0, 0, ink.width, ink.height);
  inx.save();
  if (stage !== 'draw' && sel && sel.w > 0) { inx.setTransform(dpr, 0, 0, dpr, 0, 0); selPath(inx); inx.clip(); inx.setTransform(1, 0, 0, 1, 0, 0); }
  inx.drawImage(done, 0, 0);
  inx.setTransform(dpr, 0, 0, dpr, 0, 0);
  if (cur) drawShape(inx, cur);              // drawn on top, so an eraser stroke already rubs out the finished shapes
  inx.restore();
  $('#undo').disabled = !shapes.length; $('#redo').disabled = !redo.length;
}

const pt = (e) => ({ x: e.clientX, y: e.clientY });
const inSel = (p) => sel && p.x >= sel.x && p.x <= sel.x + sel.w && p.y >= sel.y && p.y <= sel.y + sel.h;

ink.addEventListener('pointerdown', (e) => {
  if (e.button !== 0 && (e.button !== 2 || stage === 'select')) return;    // right button draws in the secondary color
  const p = pt(e);
  if (editing) { commitText(); return; }
  if (stage === 'select') {
    ink.setPointerCapture(e.pointerId); api.selected();
    dragStart = p; sel = { x: p.x, y: p.y, w: 0, h: 0 }; freePts = selKind === 'free' ? [p] : null;
    drawShade(); return;
  }
  if (stage === 'annotate' && !inSel(p)) return;
  ink.setPointerCapture(e.pointerId);
  const t = tool.tool, color = e.button === 2 ? tool.color2 : tool.color;
  if (t === 'text') { openText(p, color); return; }
  const base = { type: t, color, width: tool.width };
  cur = ['pen', 'highlighter', 'eraser'].includes(t) ? { ...base, pts: [p] } : { ...base, a: p, b: p };
  render();
});
ink.addEventListener('pointermove', (e) => {
  const p = pt(e);
  if (stage === 'select' && dragStart) {
    if (selKind === 'free') { freePts.push(p); sel = growBox(sel, p); }
    else sel = { x: Math.min(dragStart.x, p.x), y: Math.min(dragStart.y, p.y), w: Math.abs(p.x - dragStart.x), h: Math.abs(p.y - dragStart.y) };
    drawShade(); return;
  }
  if (!cur) return;
  if (cur.pts) cur.pts.push(p); else cur.b = p;
  render();
});
ink.addEventListener('pointerup', () => {
  if (stage === 'select' && dragStart) {
    dragStart = null;
    if (!sel || sel.w < 4 || sel.h < 4 || (freePts && freePts.length < 3)) { sel = null; freePts = null; drawShade(); return; }
    enterAnnotate(); return;
  }
  if (!cur) return;
  shapes.push(cur); cur = null; redo = []; render();
});
function growBox(b, p) {               // bounding box of the freehand points so far, one point at a time
  const x = Math.min(b.x, p.x), y = Math.min(b.y, p.y);
  return { x, y, w: Math.max(b.x + b.w, p.x) - x, h: Math.max(b.y + b.h, p.y) - y };
}

/* ---------- text ---------- */
function openText(p, color) {
  const size = Math.round(14 + tool.width * 2.5);
  const ta = document.createElement('textarea');
  ta.id = 'texted'; ta.rows = 1; ta.spellcheck = false;
  Object.assign(ta.style, { left: p.x + 'px', top: p.y + 'px', color, fontSize: size + 'px', width: '120px', height: size * 1.25 + 4 + 'px' });
  ta.addEventListener('input', () => {
    const lines = ta.value.split('\n');
    ta.style.height = lines.length * size * 1.25 + 4 + 'px';
    ta.style.width = Math.max(120, Math.max(...lines.map((l) => l.length)) * size * .62 + 12) + 'px';
  });
  ta.addEventListener('keydown', (e) => {
    e.stopPropagation();
    if (e.key === 'Escape') { editing = null; ta.remove(); }
    else if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); commitText(); }
  });
  ta.addEventListener('blur', () => setTimeout(commitText, 0));
  document.body.append(ta);
  editing = { ta, p, size, color };
  setTimeout(() => ta.focus(), 0);
}
function commitText() {
  if (!editing) return;
  const { ta, p, size, color } = editing; editing = null;
  const text = ta.value.replace(/\s+$/, ''); ta.remove();
  if (text) { shapes.push({ type: 'text', x: p.x, y: p.y, text, size, color }); redo = []; render(); }
}

/* ---------- selection ---------- */
function selPath(c) {
  c.beginPath();
  if (selKind === 'free' && freePts) freePts.forEach((p, i) => (i ? c.lineTo(p.x, p.y) : c.moveTo(p.x, p.y)));
  else if (sel) c.rect(sel.x, sel.y, sel.w, sel.h);
  if (selKind === 'free' && freePts) c.closePath();
}
function drawShade() {
  shx.setTransform(1, 0, 0, 1, 0, 0); shx.clearRect(0, 0, shade.width, shade.height);
  if (stage === 'draw') { dimsEl.hidden = true; return; }
  shx.setTransform(dpr, 0, 0, dpr, 0, 0);
  shx.fillStyle = 'rgba(0,0,0,.45)'; shx.fillRect(0, 0, W, H);
  if (sel && sel.w > 0) {
    shx.globalCompositeOperation = 'destination-out'; selPath(shx); shx.fill();
    shx.globalCompositeOperation = 'source-over';
    selPath(shx); shx.strokeStyle = '#fff'; shx.lineWidth = 1.5; shx.setLineDash([6, 4]); shx.stroke(); shx.setLineDash([]);
    dimsEl.hidden = false;
    dimsEl.textContent = `${Math.round(sel.w * dpr)} × ${Math.round(sel.h * dpr)}`;
    dimsEl.style.left = Math.max(4, sel.x) + 'px';
    dimsEl.style.top = (sel.y > 30 ? sel.y - 28 : sel.y + 6) + 'px';
  } else dimsEl.hidden = true;
}
function enterAnnotate() {
  setStage('annotate'); modebar.hidden = true;
  tool.tool = tool.tool === 'eraser' ? 'pen' : tool.tool; syncToolUI();
  ink.style.cursor = 'crosshair';
  toolbar.hidden = false;
  const h = toolbar.offsetHeight || 84, w = toolbar.offsetWidth || 644;
  let y = sel.y + sel.h + 12;
  if (y + h > H - 4) y = sel.y - h - 12;
  if (y < 4) y = Math.min(H - h - 12, sel.y + sel.h - h - 12);
  placeToolbar(sel.x + sel.w / 2 - w / 2, Math.max(4, y));
  drawShade(); render();
}
function updateModebar() {
  $$('#modebar [data-mode]').forEach((b) => b.classList.toggle('on', b.dataset.mode === selKind));
}
$$('#modebar [data-mode]').forEach((b) => b.onclick = () => {
  if (b.dataset.mode === 'full') { api.capture('full'); return; }
  selKind = b.dataset.mode; sel = null; freePts = null; updateModebar(); drawShade();
});

/* ---------- export ---------- */
function exportCanvas(forJpeg) {
  commitText();
  const x = Math.round(sel.x * dpr), y = Math.round(sel.y * dpr);
  const w = Math.max(1, Math.min(bg.width - x, Math.round(sel.w * dpr))), h = Math.max(1, Math.min(bg.height - y, Math.round(sel.h * dpr)));
  const out = document.createElement('canvas'); out.width = w; out.height = h;
  const c = out.getContext('2d');
  if (forJpeg) { c.fillStyle = '#fff'; c.fillRect(0, 0, w, h); }
  if (selKind === 'free' && freePts) {
    c.beginPath(); freePts.forEach((p, i) => { const px = p.x * dpr - x, py = p.y * dpr - y; i ? c.lineTo(px, py) : c.moveTo(px, py); });
    c.closePath(); c.clip();
  }
  c.drawImage(bg, x, y, w, h, 0, 0, w, h);
  c.drawImage(ink, x, y, w, h, 0, 0, w, h);
  return out;
}
const toBytes = (canvas, type) => new Promise((res) => canvas.toBlob(async (b) => res(new Uint8Array(await b.arrayBuffer())), type, .93));

const waitBg = () => (bgReady ? Promise.resolve() : new Promise((r) => { bgWaiters = r; }));
async function doCopy() {
  if (!sel) return;
  await waitBg();
  const ok = await api.copy(await toBytes(exportCanvas(false), 'image/png'));
  finish(ok ? 'Copied to clipboard' : 'Copy failed');
}
async function doSave() {
  if (!sel) return;
  const file = await api.saveDialog();
  if (!file) return;
  await waitBg();
  const jpeg = /\.jpe?g$/i.test(file);
  const ok = await api.writeFile(file, await toBytes(exportCanvas(jpeg), jpeg ? 'image/jpeg' : 'image/png'));
  finish(ok ? 'Saved ' + file.split(/[\\/]/).pop() : 'Save failed');
}
function finish(msg) {
  const t = $('#toast'); t.textContent = msg; t.hidden = false; toolbar.hidden = true;
  clearTimeout(finishTimer);
  // Started from drawing mode: go straight back to the drawings and let the message linger there.
  if (drawSnap) { api.close(); finishTimer = setTimeout(() => { t.hidden = true; }, 1200); return; }
  // Otherwise the screen is given back at once (frozen frame gone, clicks pass through) while the message shows.
  document.body.classList.add('finished'); api.ignore(true);
  finishTimer = setTimeout(() => api.close(), 900);
}

/* ---------- keyboard ---------- */
window.addEventListener('keydown', (e) => {
  if (editing) return;
  const k = e.key.toLowerCase();
  if (e.key === 'Escape') return api.close();
  if (stage === 'select' && e.key === 'Tab') {
    e.preventDefault(); selKind = selKind === 'free' ? 'region' : 'free'; sel = null; freePts = null; updateModebar(); drawShade(); return;
  }
  if (e.ctrlKey || e.metaKey) {
    if (k === 'z' && !e.shiftKey) undo();
    else if (k === 'y' || (k === 'z' && e.shiftKey)) redoFn();
    else if (k === 'c' && stage === 'annotate') doCopy();
    else if (k === 's' && stage === 'annotate') { e.preventDefault(); doSave(); }
    return;
  }
  if (stage === 'select' || e.altKey) return;
  const n = /^[1-9]$/.test(e.key) ? +e.key : 0;
  if (n && n <= TOOLS.length) { tool.tool = TOOLS[n - 1]; pushTool(); }
  if (e.key === 'Enter' && stage === 'annotate') doCopy();
});

// Shift+wheel changes the thickness (the plain wheel scrolls the window underneath, see wheel.js).
let ringTimer = 0;
window.addEventListener('wheel', (e) => {
  if (!e.shiftKey || stage === 'select') return;
  const d = e.deltaY || e.deltaX;                  // Chromium turns Shift+wheel into horizontal scrolling
  if (!d) return;
  tool.width = Math.max(1, Math.min(24, tool.width + (d < 0 ? 1 : -1))); pushTool();
  const r = $('#sizering'), s = Math.max(4, tool.width) + 'px';
  Object.assign(r.style, { left: e.clientX + 'px', top: e.clientY + 'px', width: s, height: s }); r.hidden = false;
  clearTimeout(ringTimer); ringTimer = setTimeout(() => { r.hidden = true; }, 700);
}, { passive: true });
