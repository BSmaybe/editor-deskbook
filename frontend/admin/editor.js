/**
 * Floor Editor v2 — SVG-first canonical layout editor
 * Modes: select | pan | wall | boundary | partition | desk
 * No external dependencies.
 */

'use strict';

/* ── Constants ──────────────────────────────────────────────────────────────── */
const API = '/api';
const NS  = 'http://www.w3.org/2000/svg';

const STRUCT_COLORS = {
  wall:      '#64748b',
  boundary:  '#1d4ed8',
  partition: '#475569',
};
const DEFAULT_ZONE_COLOR = STRUCT_COLORS.boundary;
const STRUCT_OPACITY = { wall: 1, boundary: 0.15, partition: 0.7 };
const MAX_LAYOUT_DESKS = 2000;
const PX_CLOSE_THRESHOLD = 14;
const MARQUEE_MIN_PX = 4;
const OBJECT_HIT_PX = 14;
const PANEL_LEFT_KEY = 'editor_left_collapsed';
const PANEL_RIGHT_KEY = 'editor_right_collapsed';

const DESK_COLORS = {
  flex:     { fill: '#dbeafe', stroke: '#2563eb' },
  fixed:    { fill: '#fef3c7', stroke: '#d97706' },
  disabled: { fill: '#f1f5f9', stroke: '#94a3b8' },
  occupied: { fill: '#fee2e2', stroke: '#dc2626' },
};

const MODE_HINTS = {
  select:    'Клик — выбор; тащи — перемещение; Пробел+тащи — рука',
  pan:       'Тащи для панорамирования; колесо — зум',
  wall:      'Клик — добавить точку; Enter/двойной клик — завершить; Esc — отменить',
  boundary:  'Клик — точка; клик рядом с первой — замкнуть; Enter — замкнуть; Esc — отменить',
  partition: 'Клик — точка; Enter — завершить; Esc — отменить',
  desk:      'Клик — поставить стол; для блока выберите "Блок" в панели ниже',
};

/* ── State ──────────────────────────────────────────────────────────────────── */
let ld = null;        // LayoutDocument (canonical)
let ed = resetEd();

function resetEd() {
  return {
    floorId:  null,
    status:   null,
    version:  0,
    dirty:    false,
    locked:   false,
    lockOwner: null,
    lockExpiresAt: null,
    lockRenewInterval: null,

    // Viewport
    vb: { x: 0, y: 0, w: 1000, h: 1000 },

    bgAdjust: {
      active: false,
      dragging: false,
      start: null,
    },

    // Tool
    mode: 'select',
    snapGrid: false,
    gridSize: 10,
    altSnapOff: false,
    shiftFine: false,
    deskTool: {
      placeMode: 'single', // single | block
      pattern: 'rows',     // rows | double
      axis: 'horizontal',  // horizontal | vertical
      seatsPerRow: 6,
      rowCount: 2,
      pairCount: 1,
      preview: null,       // transient preview for block placement
    },

    // Drawing (wall/boundary/partition)
    drawing: null,   // { type, pts: [[x,y],...], rubberPt: [x,y] }

    // Selection
    selType: null,   // 'desk' | 'wall' | 'boundary' | 'partition'
    selId:   null,
    multiDeskIds: [],
    marquee: null,   // { pointerId, start:{x,y}, current:{x,y}, append:boolean }
    dragGroup: null, // { pointerId, startPt:{x,y}, items:[{desk,x,y}] }

    // Pan
    panning:  false,
    panStart: null,

    // Space-key hand
    spaceDown: false,
    spacePanning: false,
    spacePanStart: null,
  };
}

/* ── Tiny ID helper ─────────────────────────────────────────────────────────── */
function uid() {
  return (typeof crypto !== 'undefined' && crypto.randomUUID)
    ? crypto.randomUUID()
    : 'id-' + Math.random().toString(36).slice(2);
}

/* ── Auth header ────────────────────────────────────────────────────────────── */
function ah() {
  const t = localStorage.getItem('admin_token');
  return t ? { Authorization: 'Bearer ' + t } : {};
}

/* ── Viewport helpers ───────────────────────────────────────────────────────── */
function setVb(x, y, w, h) {
  ed.vb = { x, y, w, h };
  const svg = _svg();
  if (svg) svg.setAttribute('viewBox', `${x} ${y} ${w} ${h}`);
  updateMinimap();
  updateStatusBar();
  updateGridPattern();
}

function svgPt(e) {
  const svg = _svg();
  if (!svg) return { x: 0, y: 0 };

  // Use SVG screen CTM for accurate coordinate mapping.
  // This handles preserveAspectRatio and any visual letterboxing,
  // so pointer placement matches the visible plan exactly.
  const ctm = svg.getScreenCTM();
  if (ctm) {
    const pt = svg.createSVGPoint();
    pt.x = e.clientX;
    pt.y = e.clientY;
    const p = pt.matrixTransform(ctm.inverse());
    return { x: p.x, y: p.y };
  }

  // Fallback when CTM is unavailable.
  const r = svg.getBoundingClientRect();
  const px = (e.clientX - r.left) / r.width;
  const py = (e.clientY - r.top) / r.height;
  return { x: ed.vb.x + px * ed.vb.w, y: ed.vb.y + py * ed.vb.h };
}

function snapV(v) {
  if (ed.altSnapOff || !ed.snapGrid) return v;
  const step = Math.max(0.1, ed.shiftFine ? ed.gridSize / 4 : ed.gridSize);
  return Math.round(v / step) * step;
}

function worldUnitsForScreenPx(px) {
  const svg = _svg();
  if (!svg || !Number.isFinite(px) || px <= 0) return 0;
  const ctm = svg.getScreenCTM();
  if (ctm) {
    const sx = Math.hypot(ctm.a, ctm.b);
    const sy = Math.hypot(ctm.c, ctm.d);
    const scale = (sx + sy) / 2;
    if (scale > 0) return px / scale;
  }
  const rect = svg.getBoundingClientRect();
  if (!rect.width) return px;
  return px * (ed.vb.w / rect.width);
}

function clampInt(v, min, max, fallback) {
  const n = parseInt(v, 10);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(min, Math.min(max, n));
}

function collectDeskNumberSet() {
  const used = new Set();
  for (const d of (ld?.desks || [])) {
    const m = /^D-(\d+)$/i.exec(String(d.label || '').trim());
    if (m) used.add(parseInt(m[1], 10));
  }
  return used;
}

function takeNextDeskLabel(used) {
  let n = 1;
  while (used.has(n)) n++;
  used.add(n);
  return 'D-' + n;
}

function defaultDeskSize() {
  if (!ld) return { w: 40, h: 22 };
  return { w: ld.vb[2] * 0.04, h: ld.vb[3] * 0.022 };
}

function makeDeskRecord(rect, label) {
  return {
    id: uid(), label, name: null, team: null, dept: null,
    bookable: true, fixed: false, assigned_to: null, status: 'available',
    x: rect.x, y: rect.y, w: rect.w, h: rect.h, r: 0,
  };
}

function rectsOverlap(a, b) {
  return a.x < b.x + b.w && a.x + a.w > b.x &&
         a.y < b.y + b.h && a.y + a.h > b.y;
}

function isDeskBlockMode() {
  return ed.mode === 'desk' && ed.deskTool.placeMode === 'block';
}

function syncDeskBulkControls() {
  const panel = $el('ed-desk-bulk-panel');
  const show = ed.mode === 'desk';
  panel?.classList.toggle('ed-hidden', !show);
  if (!show) return;

  ed.deskTool.seatsPerRow = clampInt(ed.deskTool.seatsPerRow, 1, 100, 6);
  ed.deskTool.rowCount = clampInt(ed.deskTool.rowCount, 1, 50, 2);
  ed.deskTool.pairCount = clampInt(ed.deskTool.pairCount, 1, 25, 1);
  if (!['single', 'block'].includes(ed.deskTool.placeMode)) ed.deskTool.placeMode = 'single';
  if (!['rows', 'double'].includes(ed.deskTool.pattern)) ed.deskTool.pattern = 'rows';
  if (!['horizontal', 'vertical'].includes(ed.deskTool.axis)) ed.deskTool.axis = 'horizontal';

  _v('ed-desk-place-mode', ed.deskTool.placeMode);
  _v('ed-desk-block-pattern', ed.deskTool.pattern);
  _v('ed-desk-block-axis', ed.deskTool.axis);
  _v('ed-desk-seats-per-row', ed.deskTool.seatsPerRow);
  _v('ed-desk-row-count', ed.deskTool.rowCount);
  _v('ed-desk-pair-count', ed.deskTool.pairCount);

  $el('ed-desk-rows-field')?.classList.toggle('ed-hidden', ed.deskTool.pattern !== 'rows');
  $el('ed-desk-pairs-field')?.classList.toggle('ed-hidden', ed.deskTool.pattern !== 'double');

  const note = $el('ed-desk-bulk-note');
  if (note) {
    if (ed.deskTool.placeMode === 'single') {
      note.textContent = 'Одиночный режим: клик по холсту ставит одно место';
    } else if (ed.deskTool.preview?.awaitConfirm) {
      note.textContent = 'Превью готово: клик по холсту подтвердит вставку, Esc — отменит';
    } else {
      note.textContent = 'Режим блока: выберите ориентацию, drag задает направление, затем клик для подтверждения';
    }
  }

  const conflictEl = $el('ed-desk-bulk-conflicts');
  if (conflictEl) {
    conflictEl.classList.remove('ok');
    const preview = ed.deskTool.preview;
    if (ed.deskTool.placeMode !== 'block' || !preview) {
      conflictEl.textContent = '';
    } else if (preview.overflow) {
      conflictEl.textContent = `Превышение лимита: максимум ${MAX_LAYOUT_DESKS} мест`;
    } else if (preview.conflicts > 0) {
      conflictEl.textContent = `Конфликтов: ${preview.conflicts}`;
    } else {
      conflictEl.textContent = `Без конфликтов (${preview.desks.length})`;
      conflictEl.classList.add('ok');
    }
  }
}

function fitToScreen() {
  if (!ld) return;
  const wrap = document.getElementById('ed-canvas-wrap');
  if (!wrap) return;
  const [vbx, vby, vbw, vbh] = ld.vb;
  const ww = wrap.clientWidth, wh = wrap.clientHeight - 26; // minus statusbar
  const scaleX = ww / vbw, scaleY = wh / vbh;
  const scale = Math.min(scaleX, scaleY) * 0.92;
  const nw = vbw / scale, nh = vbh / scale;
  const nx = vbx - (nw - vbw) / 2;
  const ny = vby - (nh - vbh) / 2;
  setVb(nx, ny, nw, nh);
}

function zoomBy(factor, cx, cy) {
  const vb = ed.vb;
  if (cx === undefined) { cx = vb.x + vb.w / 2; cy = vb.y + vb.h / 2; }
  const nw = vb.w * factor, nh = vb.h * factor;
  // Clamp: 5× zoom in, 10× zoom out relative to content
  const origW = ld ? ld.vb[2] : 1000;
  const origH = ld ? ld.vb[3] : 1000;
  if (nw < origW / 20 || nw > origW * 20) return;
  const nx = cx - (cx - vb.x) * (nw / vb.w);
  const ny = cy - (cy - vb.y) * (nh / vb.h);
  setVb(nx, ny, nw, nh);
}

/* ── DOM shortcuts ──────────────────────────────────────────────────────────── */
function _svg()  { return document.getElementById('ed-svg'); }
function _layer(id) { return document.getElementById('ed-layer-' + id); }
function $el(id) { return document.getElementById(id); }

function _bgSrc(url) {
  const raw = String(url || '').trim();
  if (!raw) return null;
  if (/^https?:\/\//i.test(raw) || raw.startsWith('//')) return raw;
  if (raw.startsWith('/api/')) return raw;
  if (raw.startsWith('/static/')) return '/api' + raw;
  return raw;
}

function _layoutHasGeometry(doc) {
  if (!doc) return false;
  return !!(
    (doc.walls?.length || 0) +
    (doc.boundaries?.length || 0) +
    (doc.partitions?.length || 0) +
    (doc.desks?.length || 0)
  );
}

function _readRasterDims(file) {
  return new Promise((resolve, reject) => {
    try {
      const url = URL.createObjectURL(file);
      const img = new Image();
      img.onload = () => {
        const out = {
          w: Math.max(1, Number(img.naturalWidth || 0)),
          h: Math.max(1, Number(img.naturalHeight || 0)),
        };
        URL.revokeObjectURL(url);
        resolve(out);
      };
      img.onerror = () => {
        URL.revokeObjectURL(url);
        reject(new Error('image load failed'));
      };
      img.src = url;
    } catch (e) {
      reject(e);
    }
  });
}

function _readImageDimsFromUrl(src) {
  return new Promise((resolve, reject) => {
    try {
      const img = new Image();
      img.onload = () => resolve({
        w: Math.max(1, Number(img.naturalWidth || 0)),
        h: Math.max(1, Number(img.naturalHeight || 0)),
      });
      img.onerror = () => reject(new Error('image load failed'));
      img.src = src;
    } catch (e) {
      reject(e);
    }
  });
}

function _fitRectMeet(boxW, boxH, imgW, imgH) {
  const bw = Math.max(1, Number(boxW || 0));
  const bh = Math.max(1, Number(boxH || 0));
  const iw = Math.max(1, Number(imgW || 0));
  const ih = Math.max(1, Number(imgH || 0));
  const boxRatio = bw / bh;
  const imgRatio = iw / ih;
  if (imgRatio >= boxRatio) {
    const w = bw;
    const h = bw / imgRatio;
    return { x: 0, y: (bh - h) / 2, w, h };
  }
  const h = bh;
  const w = bh * imgRatio;
  return { x: (bw - w) / 2, y: 0, w, h };
}

function normalizeHexColor(value, fallback = DEFAULT_ZONE_COLOR) {
  const raw = String(value || '').trim();
  if (/^#[0-9a-f]{3}$/i.test(raw)) {
    return `#${raw[1]}${raw[1]}${raw[2]}${raw[2]}${raw[3]}${raw[3]}`.toLowerCase();
  }
  if (/^#[0-9a-f]{6}$/i.test(raw)) return raw.toLowerCase();
  return fallback;
}

function centroidOfPoints(pts) {
  if (!Array.isArray(pts) || pts.length === 0) return { x: 0, y: 0 };
  let sx = 0;
  let sy = 0;
  for (const p of pts) {
    sx += Number(p?.[0] || 0);
    sy += Number(p?.[1] || 0);
  }
  return { x: sx / pts.length, y: sy / pts.length };
}

function getCanvasRect() {
  if (!ld) return { x: 0, y: 0, w: 1000, h: 1000 };
  const vb = Array.isArray(ld.vb) && ld.vb.length >= 4 ? ld.vb : [0, 0, 1000, 1000];
  const x = Number(vb[0] || 0);
  const y = Number(vb[1] || 0);
  const w = Math.max(1, Number(vb[2] || 1000));
  const h = Math.max(1, Number(vb[3] || 1000));
  return { x, y, w, h };
}

function getBackgroundRect() {
  const vb = getCanvasRect();
  const t = ld?.bg_transform;
  if (!t) return { ...vb };
  const x = Number(t.x);
  const y = Number(t.y);
  const w = Number(t.w);
  const h = Number(t.h);
  if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(w) || !Number.isFinite(h) || w <= 0 || h <= 0) {
    return { ...vb };
  }
  return { x, y, w, h };
}

function setBackgroundRect(rect, opts = {}) {
  if (!ld || !rect) return;
  const x = Number(rect.x);
  const y = Number(rect.y);
  const w = Math.max(1, Number(rect.w));
  const h = Math.max(1, Number(rect.h));
  if (![x, y, w, h].every(Number.isFinite)) return;
  ld.bg_transform = { x, y, w, h };
  renderBackground();
  if (opts.markDirty) markDirty();
}

function clearSelectionState(opts = {}) {
  ed.selType = null;
  ed.selId = null;
  if (!opts.keepMulti) ed.multiDeskIds = [];
}

function hasMultiDeskSelection() {
  return Array.isArray(ed.multiDeskIds) && ed.multiDeskIds.length > 0;
}

function isDeskSelected(deskId) {
  if (!deskId) return false;
  if (ed.selType === 'desk' && ed.selId === deskId) return true;
  return (ed.multiDeskIds || []).includes(deskId);
}

function setMultiDeskSelection(ids, append = false) {
  const current = append ? new Set(ed.multiDeskIds || []) : new Set();
  for (const id of (ids || [])) {
    if (id) current.add(id);
  }
  ed.multiDeskIds = Array.from(current);
  ed.selType = null;
  ed.selId = null;
  renderDesks();
  renderSelection();
  renderObjectList();
  showPropsFor(null, null);
}

function deskSelectionBounds(ids) {
  const selected = (ld?.desks || []).filter(d => ids.includes(d.id));
  if (!selected.length) return null;
  let x1 = Infinity;
  let y1 = Infinity;
  let x2 = -Infinity;
  let y2 = -Infinity;
  for (const d of selected) {
    x1 = Math.min(x1, d.x);
    y1 = Math.min(y1, d.y);
    x2 = Math.max(x2, d.x + d.w);
    y2 = Math.max(y2, d.y + d.h);
  }
  return { x: x1, y: y1, w: Math.max(1, x2 - x1), h: Math.max(1, y2 - y1) };
}

function pointSegmentDistance(px, py, ax, ay, bx, by) {
  const abx = bx - ax;
  const aby = by - ay;
  const apx = px - ax;
  const apy = py - ay;
  const den = abx * abx + aby * aby;
  if (den <= 1e-9) return Math.hypot(px - ax, py - ay);
  const t = Math.max(0, Math.min(1, (apx * abx + apy * aby) / den));
  const qx = ax + abx * t;
  const qy = ay + aby * t;
  return Math.hypot(px - qx, py - qy);
}

function pointInPolygon(px, py, pts) {
  if (!Array.isArray(pts) || pts.length < 3) return false;
  let inside = false;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const xi = Number(pts[i]?.[0] || 0);
    const yi = Number(pts[i]?.[1] || 0);
    const xj = Number(pts[j]?.[0] || 0);
    const yj = Number(pts[j]?.[1] || 0);
    const crosses = ((yi > py) !== (yj > py)) &&
      (px < ((xj - xi) * (py - yi)) / Math.max(1e-9, (yj - yi)) + xi);
    if (crosses) inside = !inside;
  }
  return inside;
}

function rectPointDistance(px, py, x, y, w, h) {
  const x1 = x;
  const y1 = y;
  const x2 = x + w;
  const y2 = y + h;
  const dx = px < x1 ? x1 - px : (px > x2 ? px - x2 : 0);
  const dy = py < y1 ? y1 - py : (py > y2 ? py - y2 : 0);
  return Math.hypot(dx, dy);
}

function findNearestObjectAtPoint(pt, thresholdPx = OBJECT_HIT_PX) {
  if (!ld || !pt) return null;
  const threshold = worldUnitsForScreenPx(Math.max(2, thresholdPx));
  let best = null;
  let bestDist = Number.POSITIVE_INFINITY;

  for (const d of (ld.desks || [])) {
    const dist = rectPointDistance(pt.x, pt.y, d.x, d.y, d.w, d.h);
    if (dist <= threshold && dist < bestDist) {
      bestDist = dist;
      best = { type: 'desk', id: d.id };
    }
  }

  const scanStruct = (arr, type) => {
    for (const el of (arr || [])) {
      const pts = Array.isArray(el.pts) ? el.pts : [];
      if (pts.length < 2) continue;
      if (el.closed && pointInPolygon(pt.x, pt.y, pts)) {
        if (0 <= bestDist) {
          bestDist = 0;
          best = { type, id: el.id };
        }
        continue;
      }
      let minDist = Number.POSITIVE_INFINITY;
      const lim = el.closed ? pts.length : pts.length - 1;
      for (let i = 0; i < lim; i++) {
        const a = pts[i];
        const b = pts[(i + 1) % pts.length];
        const d = pointSegmentDistance(
          pt.x,
          pt.y,
          Number(a?.[0] || 0),
          Number(a?.[1] || 0),
          Number(b?.[0] || 0),
          Number(b?.[1] || 0),
        );
        if (d < minDist) minDist = d;
      }
      if (minDist <= threshold && minDist < bestDist) {
        bestDist = minDist;
        best = { type, id: el.id };
      }
    }
  };

  scanStruct(ld.boundaries, 'boundary');
  scanStruct(ld.walls, 'wall');
  scanStruct(ld.partitions, 'partition');
  return best;
}

async function syncCanvasToBackground() {
  if (!ld) { edToast('Сначала выберите этаж', 'error'); return; }
  const src = _bgSrc(ld.bg_url);
  if (!src) { edToast('Сначала загрузите фон', 'error'); return; }

  let dims;
  try {
    dims = await _readImageDimsFromUrl(src);
  } catch {
    edToast('Не удалось прочитать размер фона', 'error');
    return;
  }
  if (!dims?.w || !dims?.h) {
    edToast('Некорректный размер фона', 'error');
    return;
  }

  const bg = getBackgroundRect();
  const fit = _fitRectMeet(bg.w, bg.h, dims.w, dims.h);
  const imgX = bg.x + fit.x;
  const imgY = bg.y + fit.y;
  const imgW = Math.max(1e-6, fit.w);
  const imgH = Math.max(1e-6, fit.h);

  const mapX = (x) => ((Number(x || 0) - imgX) / imgW) * dims.w;
  const mapY = (y) => ((Number(y || 0) - imgY) / imgH) * dims.h;
  const mapW = (w) => (Number(w || 0) / imgW) * dims.w;
  const mapH = (h) => (Number(h || 0) / imgH) * dims.h;

  const mapPts = (pts) => (pts || []).map(p => [mapX(p?.[0]), mapY(p?.[1])]);

  ld.walls = (ld.walls || []).map(el => ({ ...el, pts: mapPts(el.pts) }));
  ld.boundaries = (ld.boundaries || []).map(el => ({ ...el, pts: mapPts(el.pts) }));
  ld.partitions = (ld.partitions || []).map(el => ({ ...el, pts: mapPts(el.pts) }));
  ld.desks = (ld.desks || []).map(d => ({
    ...d,
    x: mapX(d.x),
    y: mapY(d.y),
    w: Math.max(1, mapW(d.w)),
    h: Math.max(1, mapH(d.h)),
  }));
  ld.vb = [0, 0, dims.w, dims.h];
  ld.bg_transform = { x: 0, y: 0, w: dims.w, h: dims.h };

  markDirty();
  fitToScreen();
  renderAll();
  if (ed.selType && ed.selId) showPropsFor(ed.selType, ed.selId);
  updateStatusBar();
  edToast(`SVG подогнан под фон: ${dims.w}×${dims.h}`, 'success');
}

async function clearBackground() {
  if (!ld) { edToast('Сначала выберите этаж', 'error'); return; }
  if (!ld.bg_url) { edToast('Фон уже удалён', 'info'); return; }
  if (!confirm('Удалить фоновое изображение с этого этажа?')) return;

  setBackgroundAdjustMode(false);
  ld.bg_url = null;
  ld.bg_transform = null;
  markDirty();
  renderAll();
  updateEditorUI();

  if (!ed.floorId) return;
  try {
    await fetch(`${API}/floors/${ed.floorId}`, {
      method: 'PATCH',
      headers: { ...ah(), 'Content-Type': 'application/json' },
      body: JSON.stringify({ plan_url: null }),
    });
  } catch (_) {
    // Layout background is already cleared locally; floor.plan_url cleanup is best-effort.
  }
  edToast('Фон удалён. Не забудьте сохранить и опубликовать.', 'success');
}

async function syncDesksFromLayout(opts = {}) {
  if (!ed.floorId) { edToast('Сначала выберите этаж', 'error'); return; }
  const src =
    opts.source === 'draft' || opts.source === 'published'
      ? opts.source
      : (ed.status === 'draft' ? 'draft' : 'published');
  const cleanup = opts.cleanup !== false;
  const quiet = !!opts.quiet;
  try {
    const resp = await fetch(`${API}/floors/${ed.floorId}/layout/sync-desks?source=${src}&cleanup=${cleanup ? 'true' : 'false'}`, {
      method: 'POST',
      headers: ah(),
    });
    if (!resp.ok) {
      const b = await resp.json().catch(() => ({}));
      edToast('Ошибка синхронизации: ' + (b.detail || resp.status), 'error');
      return;
    }
    const result = await resp.json();
    const msg = `Синхронизация: +${result.created}, обновлено ${result.updated}, переименовано ${result.renamed}, удалено ${result.deleted}`;
    if (!quiet) edToast(msg, 'success');
    if (!quiet && result.protected_with_active_reservations > 0) {
      edToast(`Не удалено из-за активных броней: ${result.protected_with_active_reservations}`, 'info');
    }
    if (!quiet && src === 'draft') {
      edToast('Для бронирования на клиенте опубликуйте изменения.', 'info');
    }
    return result;
  } catch (ex) {
    edToast('Ошибка: ' + ex.message, 'error');
    return null;
  }
}

/* ── Render ─────────────────────────────────────────────────────────────────── */
function renderAll() {
  renderBackground();
  renderStructure();
  renderDesks();
  renderSelection();
  renderObjectList();
  updateEditorKpis();
}

function renderBackground() {
  const layer = _layer('bg');
  if (!layer) return;
  layer.innerHTML = '';
  if (!ld) return;

  const vb = getCanvasRect();
  const bg = getBackgroundRect();

  const base = document.createElementNS(NS, 'rect');
  base.setAttribute('x', String(vb.x));
  base.setAttribute('y', String(vb.y));
  base.setAttribute('width', String(vb.w));
  base.setAttribute('height', String(vb.h));
  base.setAttribute('fill', '#f8fbff');
  base.setAttribute('pointer-events', 'none');
  layer.appendChild(base);

  const src = _bgSrc(ld.bg_url);
  if (!src) return;

  const img = document.createElementNS(NS, 'image');
  img.setAttribute('id', 'ed-bg-image');
  img.setAttribute('href', src);
  img.setAttribute('x', String(bg.x));
  img.setAttribute('y', String(bg.y));
  img.setAttribute('width', String(bg.w));
  img.setAttribute('height', String(bg.h));
  img.setAttribute('preserveAspectRatio', 'xMidYMid meet');
  img.setAttribute('opacity', '0.96');
  img.setAttribute('pointer-events', ed.bgAdjust.active ? 'all' : 'none');
  if (ed.bgAdjust.active) img.style.cursor = ed.bgAdjust.dragging ? 'grabbing' : 'grab';
  layer.appendChild(img);
}

function updateEditorKpis() {
  const totalEl = $el('ed-kpi-total');
  const availableEl = $el('ed-kpi-available');
  const fixedEl = $el('ed-kpi-fixed');
  const disabledEl = $el('ed-kpi-disabled');
  if (!totalEl && !availableEl && !fixedEl && !disabledEl) return;

  const desks = ld?.desks || [];
  const total = desks.length;
  const available = desks.filter(d => d.status !== 'disabled' && d.status !== 'occupied' && d.bookable !== false && !d.fixed).length;
  const fixed = desks.filter(d => !!d.fixed).length;
  const disabled = desks.filter(d => d.status === 'disabled').length;

  if (totalEl) totalEl.textContent = String(total);
  if (availableEl) availableEl.textContent = String(available);
  if (fixedEl) fixedEl.textContent = String(fixed);
  if (disabledEl) disabledEl.textContent = String(disabled);
}

function _makePolyEl(tagName, pts, closed) {
  const el = document.createElementNS(NS, tagName);
  if (tagName === 'line' && pts.length >= 2) {
    el.setAttribute('x1', pts[0][0]); el.setAttribute('y1', pts[0][1]);
    el.setAttribute('x2', pts[1][0]); el.setAttribute('y2', pts[1][1]);
  } else {
    const pstr = pts.map(p => p[0] + ',' + p[1]).join(' ');
    if (tagName === 'polyline') el.setAttribute('points', pstr);
    if (tagName === 'polygon')  el.setAttribute('points', pstr);
  }
  return el;
}

function renderStructure() {
  const layers = { wall: _layer('wall'), boundary: _layer('boundary'), partition: _layer('partition') };
  Object.values(layers).forEach(l => { if (l) l.innerHTML = ''; });
  if (!ld) return;

  const sw = Math.max(0.5, ed.vb.w * 0.001);

  function drawElements(arr, type) {
    const layer = layers[type];
    if (!layer) return;
    const defaultColor = STRUCT_COLORS[type];

    for (const el of arr) {
      if (!el.pts || el.pts.length < 2) continue;
      const isSel = ed.selType === type && ed.selId === el.id;
      const col = type === 'boundary'
        ? normalizeHexColor(el.color, defaultColor)
        : defaultColor;
      const g = document.createElementNS(NS, 'g');
      g.dataset.id = el.id;
      g.dataset.type = type;

      const tagName = el.closed ? 'polygon' : 'polyline';
      const shape = _makePolyEl(tagName, el.pts, el.closed);
      const hitShape = _makePolyEl(tagName, el.pts, el.closed);
      const thick = (el.thick || 4) * (sw / 0.5) * 0.5;
      const hitStroke = Math.max(worldUnitsForScreenPx(OBJECT_HIT_PX), thick + worldUnitsForScreenPx(6));

      hitShape.setAttribute('fill', el.closed ? 'rgba(0,0,0,0)' : 'none');
      hitShape.setAttribute('stroke', 'rgba(0,0,0,0)');
      hitShape.setAttribute('stroke-width', String(hitStroke));
      hitShape.setAttribute('stroke-linecap', 'round');
      hitShape.setAttribute('stroke-linejoin', 'round');
      hitShape.setAttribute('pointer-events', el.closed ? 'all' : 'stroke');
      hitShape.setAttribute('cursor', ed.mode === 'select' ? 'pointer' : 'default');
      hitShape.addEventListener('pointerdown', ev => onStructPointerDown(ev, type, el.id));
      g.appendChild(hitShape);

      if (type === 'boundary') {
        shape.setAttribute('fill', el.closed === false ? 'none' : col);
        shape.setAttribute('fill-opacity', '0.12');
        shape.setAttribute('stroke', col);
        shape.setAttribute('stroke-width', String(Math.max(1, thick * 0.4)));
      } else {
        shape.setAttribute('fill', 'none');
        shape.setAttribute('stroke', col);
        shape.setAttribute('stroke-width', String(thick));
        shape.setAttribute('stroke-linecap', 'round');
        shape.setAttribute('stroke-linejoin', 'round');
      }

      if (isSel) {
        shape.setAttribute('stroke', '#3b82f6');
        shape.setAttribute('stroke-dasharray', '6 3');
      }

      shape.setAttribute('pointer-events', 'none');
      g.appendChild(shape);

      if (type === 'boundary' && el.label) {
        const c = centroidOfPoints(el.pts);
        const txt = document.createElementNS(NS, 'text');
        txt.setAttribute('x', String(c.x));
        txt.setAttribute('y', String(c.y));
        txt.setAttribute('text-anchor', 'middle');
        txt.setAttribute('dominant-baseline', 'middle');
        txt.setAttribute('font-size', String(Math.max(9, ed.vb.w * 0.011)));
        txt.setAttribute('font-family', 'system-ui, sans-serif');
        txt.setAttribute('font-weight', '700');
        txt.setAttribute('fill', isSel ? '#1e40af' : col);
        txt.setAttribute('stroke', '#ffffff');
        txt.setAttribute('stroke-width', String(Math.max(0.6, ed.vb.w * 0.0012)));
        txt.setAttribute('paint-order', 'stroke');
        txt.setAttribute('pointer-events', 'none');
        txt.textContent = el.label;
        g.appendChild(txt);
      }

      // Vertex dots when selected
      if (isSel) {
        for (const pt of el.pts) {
          const c = document.createElementNS(NS, 'circle');
          c.setAttribute('cx', pt[0]); c.setAttribute('cy', pt[1]);
          c.setAttribute('r', String(Math.max(3, ed.vb.w * 0.004)));
          c.setAttribute('fill', '#fff'); c.setAttribute('stroke', '#3b82f6');
          c.setAttribute('stroke-width', '1.5'); c.setAttribute('pointer-events', 'none');
          g.appendChild(c);
        }
      }

      layer.appendChild(g);
    }
  }

  drawElements(ld.walls,      'wall');
  drawElements(ld.boundaries, 'boundary');
  drawElements(ld.partitions, 'partition');
}

function renderDesks() {
  const layer = _layer('desk');
  if (!layer || !ld) return;
  layer.innerHTML = '';

  const swBase = Math.max(0.5, ed.vb.w * 0.0012);

  for (const desk of ld.desks) {
    const isSel = isDeskSelected(desk.id);
    const isFixed    = desk.fixed;
    const isDisabled = desk.status === 'disabled';
    const isOccupied = desk.status === 'occupied';

    let colorKey = 'flex';
    if (isDisabled)    colorKey = 'disabled';
    else if (isOccupied) colorKey = 'occupied';
    else if (isFixed)  colorKey = 'fixed';

    const { fill, stroke } = DESK_COLORS[colorKey];

    const g = document.createElementNS(NS, 'g');
    g.dataset.id = desk.id;
    const cx = desk.x + desk.w / 2, cy = desk.y + desk.h / 2;

    if (desk.r) {
      g.setAttribute('transform', `rotate(${desk.r} ${cx} ${cy})`);
    }

    const rect = document.createElementNS(NS, 'rect');
    rect.setAttribute('x', desk.x); rect.setAttribute('y', desk.y);
    rect.setAttribute('width', desk.w); rect.setAttribute('height', desk.h);
    rect.setAttribute('rx', String(Math.max(1, desk.h * 0.08)));
    rect.setAttribute('fill', fill);
    rect.setAttribute('stroke', isSel ? '#3b82f6' : stroke);
    rect.setAttribute('stroke-width', String(isSel ? swBase * 2 : swBase));
    if (isSel) rect.setAttribute('stroke-dasharray', '5 2');
    rect.setAttribute('cursor', ed.mode === 'select' ? 'pointer' : 'crosshair');
    g.appendChild(rect);

    // Label
    const txt = document.createElementNS(NS, 'text');
    txt.setAttribute('x', String(cx)); txt.setAttribute('y', String(cy));
    txt.setAttribute('text-anchor', 'middle');
    txt.setAttribute('dominant-baseline', 'middle');
    txt.setAttribute('font-size', String(Math.max(4, Math.min(desk.h * 0.38, desk.w * 0.18))));
    txt.setAttribute('fill', stroke);
    txt.setAttribute('pointer-events', 'none');
    txt.setAttribute('font-family', 'system-ui, sans-serif');
    txt.setAttribute('font-weight', '600');
    txt.textContent = desk.label;
    g.appendChild(txt);

    // Interaction — drag to move in select mode
    g.addEventListener('pointerdown', ev => onDeskPointerDown(ev, desk));
    layer.appendChild(g);
  }
}

function renderSelection() {
  const layer = _layer('sel');
  if (!layer) return;
  layer.innerHTML = '';
  if (!ld) return;

  const r = Math.max(4, ed.vb.w * 0.005);

  if (ed.selType === 'desk' && ed.selId) {
    const desk = ld.desks.find(d => d.id === ed.selId);
    if (desk) {
      // 8 resize handles
      const handles = [
        [desk.x,             desk.y],
        [desk.x + desk.w/2,  desk.y],
        [desk.x + desk.w,    desk.y],
        [desk.x + desk.w,    desk.y + desk.h/2],
        [desk.x + desk.w,    desk.y + desk.h],
        [desk.x + desk.w/2,  desk.y + desk.h],
        [desk.x,             desk.y + desk.h],
        [desk.x,             desk.y + desk.h/2],
      ];
      const cursors = ['nw-resize','n-resize','ne-resize','e-resize','se-resize','s-resize','sw-resize','w-resize'];

      handles.forEach(([hx, hy], i) => {
        const circle = document.createElementNS(NS, 'circle');
        circle.setAttribute('cx', hx); circle.setAttribute('cy', hy);
        circle.setAttribute('r', String(r));
        circle.setAttribute('fill', '#fff'); circle.setAttribute('stroke', '#3b82f6');
        circle.setAttribute('stroke-width', '1.5');
        circle.setAttribute('cursor', cursors[i]);
        circle.addEventListener('pointerdown', ev => onResizeHandleDown(ev, desk, i));
        layer.appendChild(circle);
      });
    }
  }

  if (hasMultiDeskSelection()) {
    const box = deskSelectionBounds(ed.multiDeskIds);
    if (box) {
      const rect = document.createElementNS(NS, 'rect');
      rect.setAttribute('x', String(box.x));
      rect.setAttribute('y', String(box.y));
      rect.setAttribute('width', String(box.w));
      rect.setAttribute('height', String(box.h));
      rect.setAttribute('fill', 'none');
      rect.setAttribute('stroke', '#2563eb');
      rect.setAttribute('stroke-width', String(Math.max(1.2, ed.vb.w * 0.0014)));
      rect.setAttribute('stroke-dasharray', '8 4');
      rect.setAttribute('pointer-events', 'none');
      layer.appendChild(rect);
    }
  }

  if (ed.marquee?.start && ed.marquee?.current) {
    const x1 = Math.min(ed.marquee.start.x, ed.marquee.current.x);
    const y1 = Math.min(ed.marquee.start.y, ed.marquee.current.y);
    const x2 = Math.max(ed.marquee.start.x, ed.marquee.current.x);
    const y2 = Math.max(ed.marquee.start.y, ed.marquee.current.y);
    const rect = document.createElementNS(NS, 'rect');
    rect.setAttribute('x', String(x1));
    rect.setAttribute('y', String(y1));
    rect.setAttribute('width', String(Math.max(0.5, x2 - x1)));
    rect.setAttribute('height', String(Math.max(0.5, y2 - y1)));
    rect.setAttribute('fill', 'rgba(37,99,235,0.14)');
    rect.setAttribute('stroke', '#2563eb');
    rect.setAttribute('stroke-width', String(Math.max(1, ed.vb.w * 0.0012)));
    rect.setAttribute('stroke-dasharray', '4 3');
    rect.setAttribute('pointer-events', 'none');
    layer.appendChild(rect);
  }
}

function renderDrawing() {
  const layer = _layer('draw');
  if (!layer) return;
  layer.innerHTML = '';

  if (isDeskBlockMode() && ed.deskTool.preview?.desks?.length) {
    for (const rectData of ed.deskTool.preview.desks) {
      const rect = document.createElementNS(NS, 'rect');
      rect.setAttribute('x', rectData.x);
      rect.setAttribute('y', rectData.y);
      rect.setAttribute('width', rectData.w);
      rect.setAttribute('height', rectData.h);
      rect.setAttribute('rx', String(Math.max(1, rectData.h * 0.08)));
      rect.setAttribute('fill', rectData.conflict ? '#fee2e2' : '#dbeafe');
      rect.setAttribute('fill-opacity', rectData.conflict ? '0.92' : '0.86');
      rect.setAttribute('stroke', rectData.conflict ? '#dc2626' : '#2563eb');
      rect.setAttribute('stroke-width', String(Math.max(1, ed.vb.w * 0.0012)));
      rect.setAttribute('stroke-dasharray', '5 2');
      layer.appendChild(rect);
    }
    return;
  }

  const draw = ed.drawing;
  if (!draw || !draw.pts.length) return;

  const allPts = draw.rubberPt ? [...draw.pts, draw.rubberPt] : draw.pts;
  const col = STRUCT_COLORS[draw.type] || '#3b82f6';
  const sw = Math.max(1, ed.vb.w * 0.002);

  // Polyline
  if (allPts.length >= 2) {
    const pl = document.createElementNS(NS, 'polyline');
    pl.setAttribute('points', allPts.map(p => p[0] + ',' + p[1]).join(' '));
    pl.setAttribute('fill', 'none');
    pl.setAttribute('stroke', col);
    pl.setAttribute('stroke-width', String(sw));
    pl.setAttribute('stroke-dasharray', '6 3');
    pl.setAttribute('stroke-linecap', 'round');
    layer.appendChild(pl);
  }

  // Vertex dots
  draw.pts.forEach((p, i) => {
    const c = document.createElementNS(NS, 'circle');
    c.setAttribute('cx', p[0]); c.setAttribute('cy', p[1]);
    c.setAttribute('r', String(Math.max(3, ed.vb.w * 0.004)));
    c.setAttribute('fill', i === 0 ? '#ef4444' : '#fff');
    c.setAttribute('stroke', col); c.setAttribute('stroke-width', '1.5');
    layer.appendChild(c);
  });

  // Close-distance indicator for boundary
  if (draw.type === 'boundary' && draw.pts.length >= 3 && draw.rubberPt) {
    const [fx, fy] = draw.pts[0];
    const [rx, ry] = draw.rubberPt;
    const closeR = worldUnitsForScreenPx(PX_CLOSE_THRESHOLD);
    if (Math.hypot(rx - fx, ry - fy) < closeR) {
      const snap = document.createElementNS(NS, 'circle');
      snap.setAttribute('cx', fx); snap.setAttribute('cy', fy);
      snap.setAttribute('r', String(closeR));
      snap.setAttribute('fill', 'none'); snap.setAttribute('stroke', '#22c55e');
      snap.setAttribute('stroke-width', '1.5'); snap.setAttribute('stroke-dasharray', '3 2');
      layer.appendChild(snap);
    }
  }
}

/* ── Minimap ────────────────────────────────────────────────────────────────── */
function updateMinimap() {
  if (!ld) return;
  const mmSvg = $el('ed-minimap-svg');
  const mmVp  = $el('ed-minimap-vp');
  const mm    = $el('ed-minimap');
  if (!mmSvg || !mm) return;

  const [vbx, vby, vbw, vbh] = ld.vb;
  mmSvg.setAttribute('viewBox', `${vbx} ${vby} ${vbw} ${vbh}`);

  // Redraw simplified walls/boundaries
  mmSvg.innerHTML = '';
  const bg = document.createElementNS(NS, 'rect');
  bg.setAttribute('x', vbx); bg.setAttribute('y', vby);
  bg.setAttribute('width', vbw); bg.setAttribute('height', vbh);
  bg.setAttribute('fill', '#f8fbff');
  mmSvg.appendChild(bg);

  function drawMM(arr, stroke, fill) {
    for (const el of arr) {
      if (!el.pts || el.pts.length < 2) continue;
      const shape = document.createElementNS(NS, el.closed ? 'polygon' : 'polyline');
      shape.setAttribute('points', el.pts.map(p => p[0]+','+p[1]).join(' '));
      shape.setAttribute('fill', fill || 'none');
      shape.setAttribute('stroke', stroke);
      shape.setAttribute('stroke-width', String(Math.max(1, vbw * 0.003)));
      mmSvg.appendChild(shape);
    }
  }
  drawMM(ld.boundaries, '#1d4ed8', 'rgba(29,78,216,0.15)');
  drawMM(ld.walls,      '#64748b', null);
  drawMM(ld.partitions, '#6b7280', null);

  for (const desk of ld.desks) {
    const rect = document.createElementNS(NS, 'rect');
    rect.setAttribute('x', desk.x); rect.setAttribute('y', desk.y);
    rect.setAttribute('width', desk.w); rect.setAttribute('height', desk.h);
    rect.setAttribute('fill', '#1476d6'); rect.setAttribute('opacity', '.75');
    mmSvg.appendChild(rect);
  }

  // Viewport indicator
  const mmW = mm.clientWidth || 140, mmH = mm.clientHeight || 90;
  const scaleX = mmW / vbw, scaleY = mmH / vbh;
  const vp = ed.vb;
  const vpLeft = (vp.x - vbx) * scaleX;
  const vpTop  = (vp.y - vby) * scaleY;
  const vpW    = vp.w * scaleX;
  const vpH    = vp.h * scaleY;
  if (mmVp) {
    mmVp.style.left   = Math.max(0, vpLeft) + 'px';
    mmVp.style.top    = Math.max(0, vpTop)  + 'px';
    mmVp.style.width  = Math.min(mmW, vpW)  + 'px';
    mmVp.style.height = Math.min(mmH, vpH)  + 'px';
  }
}

/* ── Status bar ─────────────────────────────────────────────────────────────── */
function updateStatusBar() {
  const modeEl  = $el('ed-status-mode');
  const hintEl  = $el('ed-status-hint');
  const precEl  = $el('ed-status-precision');
  const zoomEl  = $el('ed-status-zoom');
  if (modeEl) modeEl.textContent = 'Режим: ' + modeLabel(ed.mode);
  if (hintEl) {
    if (ed.bgAdjust.active) {
      hintEl.textContent = 'Правка фона: drag — сдвиг, колесо — масштаб, кнопка "Правка фона" — выход';
    } else if (isDeskBlockMode()) {
      hintEl.textContent = 'Клик + drag — превью блока; клик — подтвердить; Esc — отменить';
    } else {
      hintEl.textContent = MODE_HINTS[ed.mode] || '';
    }
  }
  if (precEl) {
    const flags = [];
    if (ed.altSnapOff && ed.snapGrid) flags.push('NO SNAP');
    if (ed.shiftFine) flags.push('FINE');
    precEl.textContent = flags.join(' · ');
  }
  if (zoomEl && ld) {
    const pct = Math.round(ld.vb[2] / ed.vb.w * 100);
    zoomEl.textContent = pct + '%';
  }
}

function modeLabel(m) {
  return { select:'Выбор', pan:'Рука', wall:'Стена', boundary:'Граница', partition:'Перегородка', desk:'Стол' }[m] || m;
}

/* ── Object list ────────────────────────────────────────────────────────────── */
function renderObjectList() {
  const list = $el('ed-obj-list');
  if (!list) return;
  if (!ld) { list.innerHTML = '<p style="color:#475569;font-size:12px;padding:8px 10px">Загрузите этаж</p>'; return; }

  const q = ($el('ed-obj-search')?.value || '').toLowerCase();

  function makeSection(title, items, type, colorFn) {
    if (!items.length) return '';
    const filtered = items.filter(it =>
      !q || (it.label || it.pts?.length?.toString() || '').toLowerCase().includes(q)
    );
    if (!filtered.length) return '';
    let html = `<div class="ed-obj-section-header">${title} (${filtered.length})</div>`;
    for (const it of filtered) {
      const active = type === 'desk' ? isDeskSelected(it.id) : (ed.selType === type && ed.selId === it.id);
      const lbl = it.label || `${title.slice(0,-1)} (${it.pts?.length || '?'} pts)`;
      const color = colorFn(it);
      html += `<div class="ed-obj-item${active?' active':''}" data-id="${it.id}" data-type="${type}">
        <span class="ed-obj-dot" style="background:${color}"></span>
        <span class="ed-obj-label" title="${lbl}">${lbl}</span>
      </div>`;
    }
    return html;
  }

  list.innerHTML =
    makeSection('Столы',       ld.desks,      'desk',      d => d.fixed ? '#d97706' : '#2563eb') +
    makeSection('Стены',       ld.walls,      'wall',      () => '#64748b') +
    makeSection('Границы',     ld.boundaries, 'boundary',  b => normalizeHexColor(b.color, DEFAULT_ZONE_COLOR)) +
    makeSection('Перегородки', ld.partitions, 'partition', () => '#475569');

  list.querySelectorAll('.ed-obj-item').forEach(item => {
    item.addEventListener('click', () => selectObj(item.dataset.type, item.dataset.id));
  });
}

/* ── Selection ──────────────────────────────────────────────────────────────── */
function selectObj(type, id) {
  ed.multiDeskIds = [];
  ed.selType = type;
  ed.selId   = id;
  renderStructure();
  renderDesks();
  renderSelection();
  renderObjectList();
  showPropsFor(type, id);
}

function deselect() {
  clearSelectionState();
  renderStructure();
  renderDesks();
  renderSelection();
  renderObjectList();
  showPropsFor(null, null);
}

/* ── Properties panel ───────────────────────────────────────────────────────── */
function showPropsFor(type, id) {
  const empty  = $el('ed-props-empty');
  const deskP  = $el('ed-props-desk');
  const structP = $el('ed-props-struct');
  const zoneFields = $el('ep-zone-fields');

  if (empty)   empty.classList.toggle('ed-hidden', type !== null);
  if (deskP)   deskP.classList.toggle('ed-hidden', type !== 'desk');
  if (structP) structP.classList.toggle('ed-hidden', !['wall','boundary','partition'].includes(type));
  if (zoneFields) zoneFields.classList.toggle('ed-hidden', type !== 'boundary');

  if (type === 'desk' && id && ld) {
    const d = ld.desks.find(x => x.id === id);
    if (!d) return;
    _v('ep-label', d.label);
    _v('ep-name',  d.name || '');
    _v('ep-team',  d.team || '');
    _v('ep-dept',  d.dept || '');
    _vc('ep-bookable', d.bookable !== false);
    _vc('ep-fixed',    !!d.fixed);
    _v('ep-assigned',  d.assigned_to || '');
    _v('ep-status',    d.status || 'available');
    _v('ep-x', Math.round(d.x));
    _v('ep-y', Math.round(d.y));
    _v('ep-w', Math.round(d.w));
    _v('ep-h', Math.round(d.h));
    _v('ep-r', Math.round(d.r || 0));
  }

  if (['wall','boundary','partition'].includes(type) && id && ld) {
    const arr = type === 'wall' ? ld.walls : type === 'boundary' ? ld.boundaries : ld.partitions;
    const el = arr.find(x => x.id === id);
    if (!el) return;
    _v('ep-struct-type',   type);
    _v('ep-struct-thick',  el.thick || 4);
    _vc('ep-struct-closed', !!el.closed);
    _v('ep-struct-label', type === 'boundary' ? (el.label || '') : '');
    _v('ep-struct-color', normalizeHexColor(el.color, DEFAULT_ZONE_COLOR));
    const ptCount = $el('ep-struct-pt-count');
    if (ptCount) ptCount.textContent = el.pts?.length || 0;
  }
}

function _v(id, val) { const el = $el(id); if (el) el.value = val; }
function _vc(id, checked) { const el = $el(id); if (el) el.checked = checked; }

function initPropsListeners() {
  const deskFields = ['ep-label','ep-name','ep-team','ep-dept','ep-assigned','ep-status','ep-x','ep-y','ep-w','ep-h','ep-r'];
  deskFields.forEach(fid => {
    $el(fid)?.addEventListener('input', () => applyDeskProps());
    $el(fid)?.addEventListener('change', () => applyDeskProps());
  });
  ['ep-bookable','ep-fixed'].forEach(fid => {
    $el(fid)?.addEventListener('change', () => applyDeskProps());
  });

  $el('ep-desk-del')?.addEventListener('click', () => {
    if (!ed.selId || ed.selType !== 'desk') return;
    ld.desks = ld.desks.filter(d => d.id !== ed.selId);
    deselect();
    markDirty();
    renderAll();
  });

  // Struct props
  ['ep-struct-type','ep-struct-thick','ep-struct-closed','ep-struct-color'].forEach(fid => {
    $el(fid)?.addEventListener('change', () => applyStructProps());
  });
  $el('ep-struct-label')?.addEventListener('input', () => applyStructProps());
  $el('ep-struct-label')?.addEventListener('change', () => applyStructProps());
  $el('ep-struct-del')?.addEventListener('click', () => {
    if (!ed.selId) return;
    deleteStructEl(ed.selType, ed.selId);
  });
}

function applyDeskProps() {
  if (ed.selType !== 'desk' || !ed.selId || !ld) return;
  const d = ld.desks.find(x => x.id === ed.selId);
  if (!d) return;
  d.label       = $el('ep-label')?.value || d.label;
  d.name        = $el('ep-name')?.value || null;
  d.team        = $el('ep-team')?.value || null;
  d.dept        = $el('ep-dept')?.value || null;
  d.bookable    = !!$el('ep-bookable')?.checked;
  d.fixed       = !!$el('ep-fixed')?.checked;
  d.assigned_to = $el('ep-assigned')?.value || null;
  d.status      = $el('ep-status')?.value || 'available';
  d.x = parseFloat($el('ep-x')?.value) || d.x;
  d.y = parseFloat($el('ep-y')?.value) || d.y;
  d.w = parseFloat($el('ep-w')?.value) || d.w;
  d.h = parseFloat($el('ep-h')?.value) || d.h;
  d.r = parseFloat($el('ep-r')?.value) || 0;
  markDirty();
  renderDesks();
  renderSelection();
  renderObjectList();
}

function applyStructProps() {
  if (!ed.selType || !ed.selId || !ld) return;
  const newType = $el('ep-struct-type')?.value;
  const thick   = parseFloat($el('ep-struct-thick')?.value) || 4;
  const closed  = !!$el('ep-struct-closed')?.checked;
  const zoneLabel = ($el('ep-struct-label')?.value || '').trim();
  const zoneColor = normalizeHexColor($el('ep-struct-color')?.value, DEFAULT_ZONE_COLOR);

  // Find in current array
  const srcArr = ed.selType === 'wall' ? ld.walls : ed.selType === 'boundary' ? ld.boundaries : ld.partitions;
  const idx = srcArr.findIndex(x => x.id === ed.selId);
  if (idx < 0) return;

  const el = srcArr[idx];
  el.thick  = thick;
  el.closed = closed;
  if (ed.selType === 'boundary') {
    el.label = zoneLabel || null;
    el.color = zoneColor;
  } else if (Object.prototype.hasOwnProperty.call(el, 'color')) {
    delete el.color;
  }

  // If type changed, move to different array
  if (newType && newType !== ed.selType) {
    srcArr.splice(idx, 1);
    const dstArr = newType === 'wall' ? ld.walls : newType === 'boundary' ? ld.boundaries : ld.partitions;
    if (newType === 'boundary') {
      el.color = zoneColor;
      el.label = zoneLabel || el.label || null;
    } else if (Object.prototype.hasOwnProperty.call(el, 'color')) {
      delete el.color;
    }
    dstArr.push(el);
    ed.selType = newType;
  }

  markDirty();
  renderStructure();
  renderObjectList();
  showPropsFor(ed.selType, ed.selId);
}

function deleteStructEl(type, id) {
  if (!ld || !type || !id) return;
  if (type === 'wall')      ld.walls      = ld.walls.filter(x => x.id !== id);
  if (type === 'boundary')  ld.boundaries = ld.boundaries.filter(x => x.id !== id);
  if (type === 'partition') ld.partitions = ld.partitions.filter(x => x.id !== id);
  deselect();
  markDirty();
  renderAll();
}

function deleteSelectedDesks() {
  if (!ld) return false;
  if (hasMultiDeskSelection()) {
    const ids = new Set(ed.multiDeskIds);
    const before = ld.desks.length;
    ld.desks = ld.desks.filter(d => !ids.has(d.id));
    const removed = before - ld.desks.length;
    clearSelectionState();
    if (removed > 0) {
      markDirty();
      renderAll();
      edToast(`Удалено мест: ${removed}`, 'info');
      return true;
    }
    return false;
  }
  if (ed.selType === 'desk' && ed.selId) {
    ld.desks = ld.desks.filter(d => d.id !== ed.selId);
    clearSelectionState();
    markDirty();
    renderAll();
    return true;
  }
  return false;
}

function startBackgroundDrag(e, startPt) {
  if (!ld || !ed.bgAdjust.active || !ld.bg_url) return false;
  const bg = getBackgroundRect();
  ed.bgAdjust.dragging = true;
  ed.bgAdjust.start = {
    pointerId: e.pointerId,
    pt: startPt,
    x: bg.x,
    y: bg.y,
    changed: false,
  };
  _svg()?.setPointerCapture(e.pointerId);
  renderBackground();
  return true;
}

function updateBackgroundDrag(pt) {
  const drag = ed.bgAdjust.start;
  if (!drag || !ld) return;
  const dx = pt.x - drag.pt.x;
  const dy = pt.y - drag.pt.y;
  const bg = getBackgroundRect();
  bg.x = drag.x + dx;
  bg.y = drag.y + dy;
  setBackgroundRect(bg, { markDirty: false });
  drag.changed = drag.changed || Math.abs(dx) > 0.2 || Math.abs(dy) > 0.2;
}

function endBackgroundDrag() {
  if (!ed.bgAdjust.dragging) return false;
  const changed = !!ed.bgAdjust.start?.changed;
  ed.bgAdjust.dragging = false;
  ed.bgAdjust.start = null;
  renderBackground();
  if (changed) {
    markDirty();
    return true;
  }
  return false;
}

function startMarqueeSelection(pointerId, startPt, append) {
  ed.marquee = {
    pointerId,
    start: { x: startPt.x, y: startPt.y },
    current: { x: startPt.x, y: startPt.y },
    append: !!append,
  };
  _svg()?.setPointerCapture(pointerId);
  renderSelection();
}

function updateMarqueeSelection(pt) {
  if (!ed.marquee) return;
  ed.marquee.current = { x: pt.x, y: pt.y };
  renderSelection();
}

function finishMarqueeSelection() {
  if (!ed.marquee || !ld) return false;
  const m = ed.marquee;
  const x1 = Math.min(m.start.x, m.current.x);
  const y1 = Math.min(m.start.y, m.current.y);
  const x2 = Math.max(m.start.x, m.current.x);
  const y2 = Math.max(m.start.y, m.current.y);
  ed.marquee = null;

  const dxPx = worldUnitsForScreenPx(MARQUEE_MIN_PX);
  const isClick = (x2 - x1) < dxPx && (y2 - y1) < dxPx;
  if (isClick) {
    const hit = findNearestObjectAtPoint(m.current || m.start);
    if (hit?.type && hit?.id) {
      if (hit.type === 'desk' && m.append) {
        const next = new Set(ed.multiDeskIds || []);
        if (next.has(hit.id)) next.delete(hit.id);
        else next.add(hit.id);
        setMultiDeskSelection(Array.from(next), false);
      } else {
        selectObj(hit.type, hit.id);
      }
      return true;
    }
    if (!m.append) clearSelectionState();
    renderDesks();
    renderSelection();
    renderObjectList();
    showPropsFor(null, null);
    return true;
  }

  const ids = (ld.desks || [])
    .filter(d => !(d.x > x2 || d.x + d.w < x1 || d.y > y2 || d.y + d.h < y1))
    .map(d => d.id);
  setMultiDeskSelection(ids, m.append);
  return true;
}

function startGroupDeskDrag(pointerId, startPt, deskIds) {
  if (!ld) return false;
  const ids = new Set(deskIds || []);
  const items = (ld.desks || [])
    .filter(d => ids.has(d.id))
    .map(d => ({ desk: d, x: d.x, y: d.y }));
  if (!items.length) return false;
  ed.dragGroup = { pointerId, startPt, items, moved: false };
  _svg()?.setPointerCapture(pointerId);
  return true;
}

function updateGroupDeskDrag(pt) {
  const g = ed.dragGroup;
  if (!g) return;
  const dx = pt.x - g.startPt.x;
  const dy = pt.y - g.startPt.y;
  for (const it of g.items) {
    it.desk.x = snapV(it.x + dx);
    it.desk.y = snapV(it.y + dy);
  }
  g.moved = g.moved || Math.abs(dx) > 0.2 || Math.abs(dy) > 0.2;
  renderDesks();
  renderSelection();
}

function endGroupDeskDrag() {
  if (!ed.dragGroup) return false;
  const moved = !!ed.dragGroup.moved;
  ed.dragGroup = null;
  if (moved) markDirty();
  return moved;
}

/* ── Input event handlers ───────────────────────────────────────────────────── */
function onSvgPointerDown(e) {
  const target = e.target;
  const inBackground = target === _svg() || target.closest('#ed-layer-bg') ||
                       target === document.getElementById('ed-grid-rect');
  const pt = svgPt(e);

  // Space + drag — pan regardless of mode
  if (ed.spaceDown) {
    e.preventDefault();
    ed.spacePanning = true;
    ed.spacePanStart = { svgPt: svgPt(e), vx: ed.vb.x, vy: ed.vb.y };
    _svg()?.setPointerCapture(e.pointerId);
    return;
  }

  if (ed.mode === 'pan') {
    ed.panning  = true;
    ed.panStart = { svgPt: pt, vx: ed.vb.x, vy: ed.vb.y };
    _svg()?.setPointerCapture(e.pointerId);
    document.getElementById('ed-canvas-wrap')?.classList.add('panning');
    return;
  }

  if (ed.bgAdjust.active && inBackground) {
    e.preventDefault();
    startBackgroundDrag(e, pt);
    return;
  }

  if (!inBackground) return;

  if (isDeskBlockMode()) {
    const preview = ed.deskTool.preview;
    if (preview?.awaitConfirm) return;
    e.preventDefault();
    startDeskBlockPreview(pt, e.pointerId);
    return;
  }

  if (['wall','boundary','partition'].includes(ed.mode)) {
    e.preventDefault();
    const pt = svgPt(e);
    const snapped = [snapV(pt.x), snapV(pt.y)];

    if (!ed.drawing) {
      ed.drawing = { type: ed.mode, pts: [snapped], rubberPt: snapped };
      renderDrawing();
    }
    return;
  }

  if (ed.mode === 'desk') {
    e.preventDefault();
    placeDeskAt(pt);
    return;
  }

  if (ed.mode === 'select' && inBackground) {
    e.preventDefault();
    startMarqueeSelection(e.pointerId, pt, !!e.shiftKey);
  }
}

function onSvgPointerMove(e) {
  const pt = svgPt(e);
  const coordEl = $el('ed-status-coords');
  if (coordEl) coordEl.textContent = `${Math.round(pt.x)}, ${Math.round(pt.y)}`;

  if (ed.bgAdjust.dragging) {
    updateBackgroundDrag(pt);
    return;
  }

  if (ed.dragGroup) {
    updateGroupDeskDrag(pt);
    return;
  }

  if (ed.marquee) {
    updateMarqueeSelection(pt);
    return;
  }

  // Space-pan
  if (ed.spacePanning && ed.spacePanStart) {
    const dx = pt.x - ed.spacePanStart.svgPt.x;
    const dy = pt.y - ed.spacePanStart.svgPt.y;
    setVb(ed.spacePanStart.vx - dx, ed.spacePanStart.vy - dy, ed.vb.w, ed.vb.h);
    return;
  }

  // Pan mode
  if (ed.panning && ed.panStart) {
    const dx = pt.x - ed.panStart.svgPt.x;
    const dy = pt.y - ed.panStart.svgPt.y;
    setVb(ed.panStart.vx - dx, ed.panStart.vy - dy, ed.vb.w, ed.vb.h);
    return;
  }

  if (isDeskBlockMode() && ed.deskTool.preview?.dragging) {
    rebuildDeskBlockPreview(pt);
    return;
  }

  // Drawing rubber band
  if (ed.drawing) {
    ed.drawing.rubberPt = [snapV(pt.x), snapV(pt.y)];
    renderDrawing();
  }
}

function onSvgPointerUp(e) {
  if (ed.bgAdjust.dragging) {
    endBackgroundDrag();
    return;
  }
  if (ed.dragGroup) {
    endGroupDeskDrag();
    return;
  }
  if (ed.marquee && finishMarqueeSelection()) {
    return;
  }
  if (isDeskBlockMode() && finalizeDeskBlockPreview()) {
    return;
  }
  if (ed.spacePanning) {
    ed.spacePanning = false;
    ed.spacePanStart = null;
    return;
  }
  if (ed.panning) {
    ed.panning = false;
    ed.panStart = null;
    document.getElementById('ed-canvas-wrap')?.classList.remove('panning');
  }
}

function onSvgClick(e) {
  if (ed.spacePanning || ed.panning) return;

  const target = e.target;
  const inBackground = target === _svg() ||
    target.closest('#ed-layer-bg') ||
    target === document.getElementById('ed-grid-rect');

  if (!inBackground) return;

  if (isDeskBlockMode()) {
    const preview = ed.deskTool.preview;
    if (!preview) return;
    if (preview.justReleased) {
      preview.justReleased = false;
      return;
    }
    if (preview.awaitConfirm) {
      commitDeskBlockPreview();
    }
    return;
  }

  if (['wall','boundary','partition'].includes(ed.mode) && ed.drawing) {
    const pt = svgPt(e);
    const snapped = [snapV(pt.x), snapV(pt.y)];
    const pts = ed.drawing.pts;

    // Close boundary on click near first point
    if (ed.mode === 'boundary' && pts.length >= 3) {
      const [fx, fy] = pts[0];
      const closeR = worldUnitsForScreenPx(PX_CLOSE_THRESHOLD);
      if (Math.hypot(snapped[0] - fx, snapped[1] - fy) < closeR) {
        finishDrawing(true);
        return;
      }
    }

    pts.push(snapped);
    renderDrawing();
  }
}

function onSvgDblClick(e) {
  if (['wall','partition'].includes(ed.mode) && ed.drawing) {
    finishDrawing(false);
  }
}

function onWheelZoom(e) {
  e.preventDefault();
  const pt = svgPt(e);

  // Smooth wheel zoom:
  // - proportional to wheel delta (trackpad-friendly)
  // - clamped to avoid sudden jumps on large deltas
  const rawDelta = Number.isFinite(e.deltaY) ? e.deltaY : 0;
  const delta = Math.max(-120, Math.min(120, rawDelta));
  const speed = e.ctrlKey ? 0.00075 : 0.00115;
  const factor = Math.exp(delta * speed);

  if (ed.bgAdjust.active && ld?.bg_url) {
    const bg = getBackgroundRect();
    const rx = (pt.x - bg.x) / Math.max(1e-6, bg.w);
    const ry = (pt.y - bg.y) / Math.max(1e-6, bg.h);
    const nextW = Math.max(10, bg.w * factor);
    const nextH = Math.max(10, bg.h * factor);
    const nextX = pt.x - rx * nextW;
    const nextY = pt.y - ry * nextH;
    setBackgroundRect({ x: nextX, y: nextY, w: nextW, h: nextH }, { markDirty: true });
    return;
  }
  zoomBy(factor, pt.x, pt.y);
}

function onDeskPointerDown(e, desk) {
  if (ed.mode !== 'select') return;
  e.stopPropagation();

  if (e.shiftKey) {
    const next = new Set(ed.multiDeskIds || []);
    if (next.has(desk.id)) next.delete(desk.id);
    else next.add(desk.id);
    setMultiDeskSelection(Array.from(next), false);
    return;
  }

  if (hasMultiDeskSelection() && (ed.multiDeskIds || []).includes(desk.id)) {
    const startPt = svgPt(e);
    startGroupDeskDrag(e.pointerId, startPt, ed.multiDeskIds);
    return;
  }

  selectObj('desk', desk.id);

  const startPt = svgPt(e);
  const sx = desk.x;
  const sy = desk.y;
  let moved = false;

  const onMove = ev => {
    const p = svgPt(ev);
    moved = true;
    desk.x = snapV(sx + p.x - startPt.x);
    desk.y = snapV(sy + p.y - startPt.y);
    _v('ep-x', Math.round(desk.x));
    _v('ep-y', Math.round(desk.y));
    renderDesks();
    renderSelection();
  };
  const onUp = () => {
    document.removeEventListener('pointermove', onMove);
    document.removeEventListener('pointerup', onUp);
    if (moved) markDirty();
  };
  document.addEventListener('pointermove', onMove);
  document.addEventListener('pointerup', onUp);
}

function onResizeHandleDown(e, desk, handleIdx) {
  e.stopPropagation();
  const startPt = svgPt(e);
  const sx = desk.x, sy = desk.y, sw2 = desk.w, sh = desk.h;

  const onMove = ev => {
    const p = svgPt(ev);
    const dx = snapV(p.x - startPt.x), dy = snapV(p.y - startPt.y);
    switch (handleIdx) {
      case 0: desk.x = sx+dx; desk.y = sy+dy; desk.w = sw2-dx; desk.h = sh-dy; break;
      case 1: desk.y = sy+dy; desk.h = sh-dy; break;
      case 2: desk.y = sy+dy; desk.w = sw2+dx; desk.h = sh-dy; break;
      case 3: desk.w = sw2+dx; break;
      case 4: desk.w = sw2+dx; desk.h = sh+dy; break;
      case 5: desk.h = sh+dy; break;
      case 6: desk.x = sx+dx; desk.w = sw2-dx; desk.h = sh+dy; break;
      case 7: desk.x = sx+dx; desk.w = sw2-dx; break;
    }
    desk.w = Math.max(5, desk.w); desk.h = Math.max(5, desk.h);
    _v('ep-x', Math.round(desk.x)); _v('ep-y', Math.round(desk.y));
    _v('ep-w', Math.round(desk.w)); _v('ep-h', Math.round(desk.h));
    renderDesks(); renderSelection();
  };
  const onUp = () => {
    document.removeEventListener('pointermove', onMove);
    document.removeEventListener('pointerup', onUp);
    markDirty();
  };
  document.addEventListener('pointermove', onMove);
  document.addEventListener('pointerup', onUp);
}

function onStructPointerDown(e, type, id) {
  if (ed.mode !== 'select') return;
  e.stopPropagation();
  selectObj(type, id);
}

/* ── Drawing finish ─────────────────────────────────────────────────────────── */
function finishDrawing(close) {
  if (!ed.drawing) return;
  const { type, pts } = ed.drawing;
  ed.drawing = null;
  const layer = _layer('draw');
  if (layer) layer.innerHTML = '';

  if (pts.length < 2) return;

  const el = { id: uid(), pts, thick: type === 'wall' ? 8 : type === 'partition' ? 3 : 2,
                closed: close || type === 'boundary', conf: 1.0 };
  if (type === 'boundary') {
    el.label = null;
    el.color = DEFAULT_ZONE_COLOR;
  }

  if (type === 'wall')      ld.walls.push(el);
  else if (type === 'boundary')  ld.boundaries.push(el);
  else if (type === 'partition') ld.partitions.push(el);

  markDirty();
  selectObj(type, el.id);
  renderStructure();
}

/* ── Desk placement ─────────────────────────────────────────────────────────── */
function buildDeskBlockRects(anchor, orientation, direction) {
  if (!ld) return [];
  const seatsPerRow = clampInt(ed.deskTool.seatsPerRow, 1, 100, 6);
  const rows = ed.deskTool.pattern === 'double'
    ? clampInt(ed.deskTool.pairCount, 1, 25, 1) * 2
    : clampInt(ed.deskTool.rowCount, 1, 50, 2);
  const { w, h } = defaultDeskSize();

  const seatStep = w * 1.22;
  const rowStep = h * 1.8;
  const aisleGap = h * 2.4;

  const sign = direction >= 0 ? 1 : -1;
  const ux = orientation === 'vertical' ? 0 : sign;
  const uy = orientation === 'vertical' ? sign : 0;
  const vx = orientation === 'vertical' ? 1 : 0;
  const vy = orientation === 'vertical' ? 0 : 1;

  const rects = [];
  for (let rIdx = 0; rIdx < rows; rIdx += 1) {
    let rowOffset = 0;
    if (ed.deskTool.pattern === 'double') {
      const pairIdx = Math.floor(rIdx / 2);
      const inPair = rIdx % 2;
      rowOffset = pairIdx * (rowStep * 2 + aisleGap) + inPair * rowStep;
    } else {
      rowOffset = rIdx * rowStep;
    }

    for (let cIdx = 0; cIdx < seatsPerRow; cIdx += 1) {
      const along = cIdx * seatStep;
      const cx = anchor.x + ux * along + vx * rowOffset;
      const cy = anchor.y + uy * along + vy * rowOffset;
      rects.push({
        x: snapV(cx - w / 2),
        y: snapV(cy - h / 2),
        w,
        h,
      });
    }
  }
  return rects;
}

function rebuildDeskBlockPreview(currentPt) {
  const preview = ed.deskTool.preview;
  if (!preview || !ld) return;
  preview.current = currentPt || preview.current || preview.anchor;

  const axis = ed.deskTool.axis === 'vertical' ? 'vertical' : 'horizontal';
  preview.orientation = axis;

  const dx = preview.current.x - preview.anchor.x;
  const dy = preview.current.y - preview.anchor.y;
  const dragMin = worldUnitsForScreenPx(8);

  const axisDelta = axis === 'vertical' ? dy : dx;
  if (Math.abs(axisDelta) > dragMin) {
    preview.direction = axisDelta >= 0 ? 1 : -1;
  }

  const rects = buildDeskBlockRects(preview.anchor, preview.orientation, preview.direction);
  const existing = ld.desks || [];

  let conflictCount = 0;
  const desks = rects.map(r => {
    const conflict = existing.some(d => rectsOverlap(r, d));
    if (conflict) conflictCount += 1;
    return { ...r, conflict };
  });

  preview.desks = desks;
  preview.conflicts = conflictCount;
  preview.overflow = existing.length + desks.length > MAX_LAYOUT_DESKS;

  syncDeskBulkControls();
  renderDrawing();
}

function startDeskBlockPreview(pt, pointerId) {
  const anchor = { x: snapV(pt.x), y: snapV(pt.y) };
  ed.deskTool.preview = {
    anchor,
    current: anchor,
    orientation: 'horizontal',
    direction: 1,
    dragging: true,
    awaitConfirm: false,
    justReleased: false,
    pointerId,
    desks: [],
    conflicts: 0,
    overflow: false,
  };
  rebuildDeskBlockPreview(anchor);
  _svg()?.setPointerCapture(pointerId);
}

function finalizeDeskBlockPreview() {
  const preview = ed.deskTool.preview;
  if (!preview || !preview.dragging) return false;
  preview.dragging = false;
  preview.awaitConfirm = true;
  preview.justReleased = true;
  syncDeskBulkControls();
  renderDrawing();
  return true;
}

function cancelDeskBlockPreview() {
  if (!ed.deskTool.preview) return false;
  ed.deskTool.preview = null;
  syncDeskBulkControls();
  renderDrawing();
  return true;
}

function commitDeskBlockPreview() {
  if (!ld) return false;
  const preview = ed.deskTool.preview;
  if (!preview || !preview.awaitConfirm) return false;
  if (!preview.desks.length) {
    cancelDeskBlockPreview();
    return true;
  }
  if (preview.overflow) {
    edToast(`Нельзя добавить блок: лимит ${MAX_LAYOUT_DESKS} мест на схему`, 'error');
    return true;
  }

  const used = collectDeskNumberSet();
  const inserted = preview.desks.map(r => makeDeskRecord(
    { x: r.x, y: r.y, w: r.w, h: r.h },
    takeNextDeskLabel(used),
  ));
  ld.desks.push(...inserted);
  markDirty();

  const conflicts = preview.conflicts;
  cancelDeskBlockPreview();
  renderAll();
  if (inserted[0]) selectObj('desk', inserted[0].id);
  edToast(
    `Добавлено мест: ${inserted.length}${conflicts ? ` (конфликтов: ${conflicts})` : ''}`,
    conflicts ? 'info' : 'success',
  );
  return true;
}

function placeDeskAt(pt) {
  if (!ld) return;
  if (ld.desks.length >= MAX_LAYOUT_DESKS) {
    edToast(`Достигнут лимит ${MAX_LAYOUT_DESKS} мест`, 'error');
    return;
  }
  const { w, h } = defaultDeskSize();
  const used = collectDeskNumberSet();
  const desk = makeDeskRecord(
    { x: snapV(pt.x - w / 2), y: snapV(pt.y - h / 2), w, h },
    takeNextDeskLabel(used),
  );
  ld.desks.push(desk);
  markDirty();
  selectObj('desk', desk.id);
  updateEditorKpis();
}

function setBackgroundAdjustMode(active) {
  const canUse = !!(ld?.bg_url);
  ed.bgAdjust.active = !!active && canUse;
  if (!ed.bgAdjust.active) {
    endBackgroundDrag();
  }
  const wrap = document.getElementById('ed-canvas-wrap');
  wrap?.classList.toggle('bg-adjust', ed.bgAdjust.active);
  $el('ed-bg-adjust-btn')?.classList.toggle('active', ed.bgAdjust.active);
  renderBackground();
  updateStatusBar();
}

function toggleBackgroundAdjustMode() {
  if (!ld?.bg_url) {
    edToast('Сначала загрузите фон', 'error');
    return;
  }
  setBackgroundAdjustMode(!ed.bgAdjust.active);
}

/* ── Mode switching ─────────────────────────────────────────────────────────── */
function setMode(mode) {
  // Cancel drawing when switching away
  if (ed.drawing && mode !== ed.mode) {
    ed.drawing = null;
    const l = _layer('draw'); if (l) l.innerHTML = '';
  }
  if (mode !== 'desk') {
    cancelDeskBlockPreview();
  }
  if (ed.bgAdjust.active) {
    setBackgroundAdjustMode(false);
  }
  ed.mode = mode;

  document.querySelectorAll('.ed-mode-btn').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.mode === mode);
  });

  const wrap = document.getElementById('ed-canvas-wrap');
  if (wrap) {
    wrap.className = wrap.className.replace(/\bmode-\w+/g, '');
    wrap.classList.add('mode-' + mode);
  }
  syncDeskBulkControls();
  updateStatusBar();
  renderDrawing();
}

/* ── Grid ───────────────────────────────────────────────────────────────────── */
function updateGridPattern() {
  const pat = document.getElementById('ed-grid-pat');
  const rect = document.getElementById('ed-grid-rect');
  if (!pat || !rect) return;
  pat.setAttribute('patternUnits', 'userSpaceOnUse');
  pat.setAttribute('width', String(ed.gridSize));
  pat.setAttribute('height', String(ed.gridSize));
  pat.removeAttribute('patternTransform');

  rect.setAttribute('x', String(ed.vb.x));
  rect.setAttribute('y', String(ed.vb.y));
  rect.setAttribute('width', String(ed.vb.w));
  rect.setAttribute('height', String(ed.vb.h));
}

/* ── Load floor ─────────────────────────────────────────────────────────────── */
async function edLoadFloor(floorId) {
  if (!floorId) {
    ld = null;
    ed = resetEd();
    renderAll();
    syncDeskBulkControls();
    updateStatusBar();
    updateEditorUI();
    updateLockUI();
    return;
  }

  cancelDeskBlockPreview();
  setBackgroundAdjustMode(false);
  ed.floorId = floorId;
  try {
    const resp = await fetch(`${API}/floors/${floorId}/layout`, { headers: ah() });
    if (resp.status === 404) {
      // No layout yet — create empty
      ld = { v: 2, vb: [0,0,1000,1000], bg_url: null, bg_transform: null, walls:[], boundaries:[], partitions:[], desks:[] };
      ed.status  = null;
      ed.version = 0;
    } else if (!resp.ok) {
      const b = await resp.json().catch(() => ({}));
      edToast('Ошибка загрузки: ' + (b.detail || resp.status), 'error');
      return;
    } else {
      const data = await resp.json();
      ld = data.layout;
      ed.status  = data.status;
      ed.version = data.version;
      if (ld?.bg_url && !ld.bg_transform) {
        const vb = getCanvasRect();
        ld.bg_transform = { x: vb.x, y: vb.y, w: vb.w, h: vb.h };
      }
    }

    ed.dirty = false;
    updateEditorUI();
    fitToScreen();
    renderAll();

    // Check lock
    ed.locked = false;
    ed.lockOwner = null;
    updateLockUI();
    const lockResp = await fetch(`${API}/floors/${floorId}/lock`, { headers: ah() });
    if (lockResp.ok) {
      const lk = await lockResp.json();
      if (lk.locked) {
        ed.locked    = true;
        ed.lockOwner = lk.locked_by_username;
      }
      updateLockUI();
    }
  } catch (ex) {
    edToast('Ошибка: ' + ex.message, 'error');
  }
}

/* ── Lock ───────────────────────────────────────────────────────────────────── */
async function acquireLock() {
  if (!ed.floorId) return;
  try {
    const resp = await fetch(`${API}/floors/${ed.floorId}/lock`, { method: 'POST', headers: ah() });
    if (resp.status === 423) {
      const b = await resp.json();
      edToast('Заблокировано: ' + b.detail, 'error'); return;
    }
    if (!resp.ok) { edToast('Ошибка захвата', 'error'); return; }
    const lk = await resp.json();
    ed.locked = true;
    ed.lockOwner = lk.locked_by_username;
    ed.lockExpiresAt = lk.expires_at;
    startLockRenew();
    updateLockUI();
    edToast('Редактирование захвачено (10 мин)', 'success');
  } catch (ex) {
    edToast('Ошибка: ' + ex.message, 'error');
  }
}

async function releaseLock() {
  if (!ed.floorId || !ed.locked) return;
  stopLockRenew();
  await fetch(`${API}/floors/${ed.floorId}/lock`, { method: 'DELETE', headers: ah() }).catch(() => {});
  ed.locked = false; ed.lockOwner = null;
  updateLockUI();
}

function startLockRenew() {
  stopLockRenew();
  // Renew every 8 minutes (before 10 min expiry)
  ed.lockRenewInterval = setInterval(async () => {
    if (!ed.locked || !ed.floorId) return;
    await fetch(`${API}/floors/${ed.floorId}/lock`, { method: 'POST', headers: ah() }).catch(() => {});
  }, 8 * 60 * 1000);
}

function stopLockRenew() {
  if (ed.lockRenewInterval) { clearInterval(ed.lockRenewInterval); ed.lockRenewInterval = null; }
}

function isLockOwnedByMe() {
  if (!ed.locked) return false;
  const me = localStorage.getItem('admin_username');
  if (!ed.lockOwner || !me) return true;
  return ed.lockOwner === me;
}

function updateLockUI() {
  const lockStatus = $el('ed-lock-status');
  const lockBtn    = $el('ed-lock-btn');
  if (!lockStatus || !lockBtn) return;

  if (!ed.floorId) {
    lockStatus.textContent = 'Выберите этаж для редактирования';
    lockStatus.className   = 'ed-lock-status';
    lockBtn.textContent    = 'Захватить';
    lockBtn.disabled = true;
    return;
  }

  if (ed.locked && isLockOwnedByMe()) {
    lockStatus.textContent = '🔒 Вы редактируете';
    lockStatus.className   = 'ed-lock-status locked-by-me';
    lockBtn.textContent    = 'Освободить';
    lockBtn.disabled = false;
  } else if (ed.locked) {
    lockStatus.textContent = '🔒 Занято: ' + (ed.lockOwner || 'другой админ');
    lockStatus.className   = 'ed-lock-status locked-by-other';
    lockBtn.textContent    = 'Занято';
    lockBtn.disabled = true;
  } else {
    lockStatus.textContent = '🔓 Свободно для редактирования';
    lockStatus.className   = 'ed-lock-status';
    lockBtn.textContent    = 'Захватить';
    lockBtn.disabled = false;
  }
}

/* ── Save / Publish / Discard ───────────────────────────────────────────────── */
function _parseExpectedVersion(detail) {
  const m = /expected\s+(\d+)/i.exec(String(detail || ''));
  return m ? parseInt(m[1], 10) : null;
}

async function edSaveDraft(opts = {}) {
  const quiet = !!opts.quiet;
  if (!ed.floorId || !ld) { edToast('Выберите этаж', 'error'); return false; }
  try {
    const sendSave = (version) => fetch(`${API}/floors/${ed.floorId}/layout/draft`, {
      method: 'PUT',
      headers: { ...ah(), 'Content-Type': 'application/json' },
      body: JSON.stringify({ version, layout: ld }),
    });

    let sentVersion = ed.version;
    let resp = await sendSave(sentVersion);
    if (resp.status === 409) {
      const b = await resp.json().catch(() => ({}));
      const expected = _parseExpectedVersion(b.detail);
      if (Number.isFinite(expected) && expected !== sentVersion) {
        sentVersion = expected;
        resp = await sendSave(sentVersion);
      } else {
        edToast('Конфликт версий — перезагрузите этаж', 'error');
        return false;
      }
    }

    if (!resp.ok) {
      const b = await resp.json().catch(() => ({}));
      edToast('Ошибка: ' + (b.detail || resp.status), 'error');
      return false;
    }

    const data = await resp.json();
    ed.version = data.version;
    ed.status  = data.status;
    ed.dirty   = false;
    updateEditorUI();
    if (!quiet) edToast('Черновик сохранён', 'success');
    return true;
  } catch (ex) {
    edToast('Ошибка: ' + ex.message, 'error');
    return false;
  }
}

async function edPublish() {
  if (!ed.floorId) return;
  if (!ed.dirty && ed.status !== 'draft') {
    edToast('Нет черновика для публикации. Внесите изменения и сохраните.', 'info');
    return;
  }
  if (!confirm('Опубликовать план? Клиенты увидят изменения.')) return;
  try {
    // Save first and stop if save failed.
    if (ed.dirty || ed.status !== 'draft') {
      const ok = await edSaveDraft({ quiet: true });
      if (!ok) return;
    }

    const resp = await fetch(`${API}/floors/${ed.floorId}/layout/publish`, { method:'POST', headers: ah() });
    if (!resp.ok) {
      const b = await resp.json().catch(() => ({}));
      const detail = String(b.detail || '');
      if (/no draft to publish/i.test(detail)) {
        edToast('Нет черновика для публикации. Сначала нажмите "Сохранить".', 'error');
      } else {
        edToast('Ошибка: ' + (b.detail || resp.status), 'error');
      }
      return;
    }
    const data = await resp.json();
    ed.version = data.version;
    ed.status  = data.status;
    ed.dirty   = false;
    updateEditorUI();
    edToast('Опубликовано ✓', 'success');
    const syncResult = await syncDesksFromLayout({ source: 'published', cleanup: true, quiet: true });
    if (syncResult) {
      edToast(
        `Места синхронизированы: +${syncResult.created}, обновлено ${syncResult.updated}, удалено ${syncResult.deleted}`,
        'info'
      );
    }
  } catch (ex) { edToast('Ошибка: ' + ex.message, 'error'); }
}

async function edDiscard() {
  if (!ed.floorId) return;
  if (!confirm('Отменить черновик? Несохранённые изменения будут потеряны.')) return;
  try {
    await fetch(`${API}/floors/${ed.floorId}/layout/draft`, { method: 'DELETE', headers: ah() });
    await edLoadFloor(ed.floorId);
    edToast('Черновик отменён', 'info');
  } catch (ex) { edToast('Ошибка: ' + ex.message, 'error'); }
}

/* ── Import ─────────────────────────────────────────────────────────────────── */
let _importResult = null;

async function handleImportFile(file) {
  if (!ed.floorId) { edToast('Сначала выберите этаж', 'error'); return; }

  const name = String(file.name || '').toLowerCase();
  const isRaster =
    (file.type && file.type.startsWith('image/')) ||
    /\.(png|jpg|jpeg|webp)$/i.test(name);
  const isSvg = file.type === 'image/svg+xml' || name.endsWith('.svg');

  if (isRaster && !isSvg) {
    // Raster background — upload as plan image
    const rasterDims = await _readRasterDims(file).catch(() => null);
    const fd = new FormData(); fd.append('file', file);
    try {
      const resp = await fetch(`${API}/floors/${ed.floorId}/plan`, {
        method: 'POST',
        headers: ah(),
        body: fd,
      });
      if (!resp.ok) { const b = await resp.json().catch(()=>({})); edToast('Ошибка: '+(b.detail||resp.status),'error'); return; }
      const data = await resp.json();
      if (!ld) ld = { v:2, vb:[0,0,1000,1000], bg_url:null, bg_transform:null, walls:[], boundaries:[], partitions:[], desks:[] };
      const canAdaptVb = !_layoutHasGeometry(ld);
      ld.bg_url = data.plan_url || null;
      if (canAdaptVb && rasterDims && rasterDims.w > 0 && rasterDims.h > 0) {
        ld.vb = [0, 0, rasterDims.w, rasterDims.h];
        ld.bg_transform = { x: 0, y: 0, w: rasterDims.w, h: rasterDims.h };
      } else {
        const vb = getCanvasRect();
        ld.bg_transform = { x: vb.x, y: vb.y, w: vb.w, h: vb.h };
      }
      markDirty();
      closeImportModal();
      if (canAdaptVb) fitToScreen();
      renderAll();
      edToast('Фон загружен', 'success');
    } catch (ex) { edToast('Ошибка: ' + ex.message, 'error'); }
    return;
  }

  // SVG — send to classifier
  try {
    const text = await file.text();
    const resp = await fetch(`${API}/floors/${ed.floorId}/layout/import`, {
      method: 'POST',
      headers: { ...ah(), 'Content-Type': 'image/svg+xml' },
      body: text,
    });
    if (!resp.ok) { const b = await resp.json().catch(()=>({})); edToast('SVG ошибка: '+(b.detail||resp.status),'error'); return; }
    _importResult = await resp.json();
    showImportResult(_importResult);
  } catch (ex) { edToast('Ошибка: ' + ex.message, 'error'); }
}

function showImportResult(res) {
  const statsEl = $el('ed-import-stats');
  const itemsEl = $el('ed-import-items');
  const resultEl = $el('ed-import-result');
  const applyBtn = $el('ed-import-apply');

  if (statsEl) {
    statsEl.innerHTML = [
      { n: res.stats.walls,      l: 'Стены'       },
      { n: res.stats.boundaries, l: 'Границы'     },
      { n: res.stats.partitions, l: 'Перегородки' },
      { n: res.stats.uncertain,  l: 'Неопределено'},
      { n: res.stats.skipped,    l: 'Пропущено'   },
      { n: res.stats.total_elements, l: 'Всего'   },
    ].map(s =>
      `<div class="ed-stat-card"><span class="num">${s.n}</span><span class="lbl">${s.l}</span></div>`
    ).join('');
  }

  if (itemsEl) {
    const all = [
      ...res.walls.map(e => ({ ...e, _type: 'wall' })),
      ...res.boundaries.map(e => ({ ...e, _type: 'boundary' })),
      ...res.partitions.map(e => ({ ...e, _type: 'partition' })),
      ...res.uncertain.map(e => ({ ...e, _type: 'uncertain' })),
    ];
    itemsEl.innerHTML = all.slice(0, 200).map((el, i) => {
      const confPct = Math.round((el.conf || 0) * 100);
      const confColor = confPct >= 70 ? '#22c55e' : confPct >= 40 ? '#f59e0b' : '#ef4444';
      return `<div style="display:flex;align-items:center;gap:8px;padding:5px 0;border-bottom:1px solid #e3ebf7">
        <select data-import-idx="${i}" style="background:#ffffff;border:1px solid #c4d4e8;color:#243b53;border-radius:5px;font-size:11px;padding:2px 4px">
          <option value="wall"      ${el._type==='wall'      ?'selected':''}>Стена</option>
          <option value="boundary"  ${el._type==='boundary'  ?'selected':''}>Граница</option>
          <option value="partition" ${el._type==='partition' ?'selected':''}>Перегородка</option>
          <option value="skip"      ${el._type==='uncertain' ?'selected':''}>Пропустить</option>
        </select>
        <span style="flex:1;color:#627d98">${el.pts?.length||0} pts</span>
        <span style="color:${confColor};font-size:10px">${confPct}%</span>
        <div class="ed-conf-bar" style="width:40px"><div class="ed-conf-fill" style="width:${confPct}%;background:${confColor}"></div></div>
      </div>`;
    }).join('') + (all.length > 200 ? `<p style="color:#829ab1;padding:4px 0">… и ещё ${all.length-200} элементов</p>` : '');
    // Store full list for apply
    itemsEl._importList = all;
  }

  if (resultEl) resultEl.classList.remove('ed-hidden');
  if (applyBtn) applyBtn.classList.remove('ed-hidden');
}

function applyImport() {
  if (!_importResult || !ld) return;
  const itemsEl = $el('ed-import-items');
  const all = itemsEl?._importList || [];

  // Use select overrides if present
  const selects = itemsEl?.querySelectorAll('select[data-import-idx]');
  const overrides = {};
  selects?.forEach(sel => { overrides[parseInt(sel.dataset.importIdx)] = sel.value; });

  let wCount = 0, bCount = 0, pCount = 0;

  // Update viewBox from import
  if (_importResult.vb) ld.vb = _importResult.vb;

  all.forEach((el, i) => {
    const type = overrides[i] || el._type;
    if (type === 'skip' || type === 'uncertain') return;
    const item = {
      id: uid(),
      pts: el.pts,
      thick: el.thick || 4,
      closed: el.closed || false,
      conf: el.conf,
      label: el.label || null,
    };
    if (type === 'boundary') {
      item.color = normalizeHexColor(el.color, DEFAULT_ZONE_COLOR);
    }
    if (type === 'wall')      { ld.walls.push(item);      wCount++; }
    if (type === 'boundary')  { ld.boundaries.push(item); bCount++; }
    if (type === 'partition') { ld.partitions.push(item); pCount++; }
  });

  markDirty();
  closeImportModal();
  fitToScreen();
  renderAll();
  edToast(`Импортировано: ${wCount} стен, ${bCount} границ, ${pCount} перегородок`, 'success');
}

function closeImportModal() {
  $el('ed-import-overlay')?.classList.add('ed-hidden');
  _importResult = null;
  const resultEl = $el('ed-import-result');
  if (resultEl) resultEl.classList.add('ed-hidden');
  const applyBtn = $el('ed-import-apply');
  if (applyBtn) applyBtn.classList.add('ed-hidden');
}

/* ── History ────────────────────────────────────────────────────────────────── */
let _historyRevisions = [];

function closeHistoryModal() {
  $el('ed-history-overlay')?.classList.add('ed-hidden');
}

function _histStatusLabel(status) {
  if (status === 'published') return 'Опубликовано';
  if (status === 'draft') return 'Черновик';
  return 'Архив';
}

function _fmtHistDate(dt) {
  if (!dt) return '—';
  try {
    return new Date(dt).toLocaleString('ru');
  } catch {
    return dt;
  }
}

function renderHistoryList() {
  const list = $el('ed-history-list');
  if (!list) return;

  if (!_historyRevisions.length) {
    list.innerHTML = '<div class="ed-history-empty">История пока пуста.</div>';
    return;
  }

  list.innerHTML = _historyRevisions.map(r => {
    const chips = [
      `<span class="ed-hist-chip ${r.status}">${_histStatusLabel(r.status)}</span>`,
      r.is_current_published ? '<span class="ed-hist-chip published">Текущая публикация</span>' : '',
      r.is_current_draft ? '<span class="ed-hist-chip draft">Текущий черновик</span>' : '',
    ].filter(Boolean).join('');

    const actor = r.created_by_username ? ` · ${r.created_by_username}` : '';
    return `<div class="ed-hist-item">
      <div class="ed-hist-top">
        <span class="ed-hist-action">Версия ${r.version} · rev ${r.revision_id}</span>
        <span class="ed-hist-meta">${_fmtHistDate(r.updated_at || r.created_at)}${actor}</span>
      </div>
      <div class="ed-hist-chips">${chips}</div>
      <div class="ed-hist-actions">
        <button class="ed-btn ed-btn-primary" data-history-restore="${r.revision_id}">Переключить на эту версию</button>
      </div>
    </div>`;
  }).join('');

  list.querySelectorAll('button[data-history-restore]').forEach(btn => {
    btn.addEventListener('click', () => {
      const revisionId = parseInt(btn.dataset.historyRestore, 10);
      if (Number.isFinite(revisionId)) edRestoreRevision(revisionId);
    });
  });
}

async function edRestoreRevision(revisionId) {
  if (!ed.floorId || !revisionId) return;
  const rev = _historyRevisions.find(x => x.revision_id === revisionId);
  const revLabel = rev ? `версию ${rev.version}` : `rev ${revisionId}`;

  if (!confirm(`Переключить редактор на ${revLabel}? Текущий черновик будет перезаписан.`)) return;

  try {
    const resp = await fetch(`${API}/floors/${ed.floorId}/layout/revisions/${revisionId}/restore`, {
      method: 'POST',
      headers: ah(),
    });
    if (!resp.ok) {
      const b = await resp.json().catch(() => ({}));
      edToast('Ошибка восстановления: ' + (b.detail || resp.status), 'error');
      return;
    }
    const data = await resp.json();
    ld = data.layout;
    ed.status = data.status;
    ed.version = data.version;
    ed.dirty = false;
    deselect();
    updateEditorUI();
    fitToScreen();
    renderAll();
    closeHistoryModal();
    edToast(`Переключено на ${revLabel}`, 'success');
  } catch (ex) {
    edToast('Ошибка: ' + ex.message, 'error');
  }
}

async function edShowHistory() {
  if (!ed.floorId) return;
  $el('ed-history-overlay')?.classList.remove('ed-hidden');
  const list = $el('ed-history-list');
  if (list) list.innerHTML = '<div class="ed-history-empty">Загрузка истории…</div>';

  try {
    const resp = await fetch(`${API}/floors/${ed.floorId}/layout/revisions?limit=100`, { headers: ah() });
    if (!resp.ok) {
      const b = await resp.json().catch(() => ({}));
      edToast('Ошибка истории: ' + (b.detail || resp.status), 'error');
      closeHistoryModal();
      return;
    }
    _historyRevisions = await resp.json();
    renderHistoryList();
  } catch (ex) {
    closeHistoryModal();
    edToast('Ошибка: ' + ex.message, 'error');
  }
}

/* ── UI update ──────────────────────────────────────────────────────────────── */
function updateEditorUI() {
  const badge   = $el('ed-status-badge');
  const saveBtn = $el('ed-save-btn');
  const pubBtn  = $el('ed-publish-btn');
  const discBtn = $el('ed-discard-btn');
  const bgAdjustBtn = $el('ed-bg-adjust-btn');
  const clearBgBtn = $el('ed-clear-bg-btn');
  const syncDesksBtn = $el('ed-sync-desks-btn');

  if (badge) {
    badge.className = 'ed-status-badge';
    if (ed.status === 'draft') {
      badge.textContent = 'ЧЕРНОВИК';
      badge.classList.add('draft');
    } else if (ed.status === 'published') {
      badge.textContent = 'ОПУБЛИКОВАНО';
      badge.classList.add('published');
    } else {
      badge.textContent = 'НЕТ КАРТЫ';
    }
  }

  const hasFloor = !!ed.floorId;
  if (saveBtn) saveBtn.disabled = !hasFloor;
  if (pubBtn)  pubBtn.disabled  = !hasFloor;
  if (discBtn) discBtn.disabled = !hasFloor || ed.status !== 'draft';
  if (bgAdjustBtn) bgAdjustBtn.disabled = !hasFloor || !ld?.bg_url;
  if (clearBgBtn) clearBgBtn.disabled = !hasFloor || !ld?.bg_url;
  if (syncDesksBtn) syncDesksBtn.disabled = !hasFloor;
  bgAdjustBtn?.classList.toggle('active', !!ed.bgAdjust.active);

  if ((!hasFloor || !ld?.bg_url) && ed.bgAdjust.active) {
    setBackgroundAdjustMode(false);
  }

  if (ed.dirty && saveBtn) {
    saveBtn.textContent = 'Сохранить *';
  } else if (saveBtn) {
    saveBtn.textContent = 'Сохранить';
  }
}

function markDirty() {
  ed.dirty = true;
  updateEditorUI();
}

/* ── Toast ──────────────────────────────────────────────────────────────────── */
function edToast(text, type) {
  if (typeof showToast === 'function') { showToast(text, type); return; }
  console.log('[editor]', type, text);
}

/* ── Keyboard shortcuts ─────────────────────────────────────────────────────── */
function initEditorKeyboard() {
  document.addEventListener('keydown', e => {
    if (e.key === 'Alt') {
      if (!ed.altSnapOff) {
        ed.altSnapOff = true;
        if (isDeskBlockMode() && ed.deskTool.preview) {
          rebuildDeskBlockPreview(ed.deskTool.preview.current || ed.deskTool.preview.anchor);
        }
        updateStatusBar();
      }
      return;
    }
    if (e.key === 'Shift') {
      if (!ed.shiftFine) {
        ed.shiftFine = true;
        if (isDeskBlockMode() && ed.deskTool.preview) {
          rebuildDeskBlockPreview(ed.deskTool.preview.current || ed.deskTool.preview.anchor);
        }
        updateStatusBar();
      }
      return;
    }

    // Don't steal input focus
    if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA' || e.target.tagName === 'SELECT') return;
    // Only handle when editor tab is active
    const tab = document.getElementById('tab-editor');
    if (!tab || tab.classList.contains('hidden')) return;

    if (e.code === 'Space') { e.preventDefault(); ed.spaceDown = true; return; }

    switch (e.key) {
      case 'v': case 'V': setMode('select');    break;
      case 'h': case 'H': setMode('pan');       break;
      case 'w': case 'W': setMode('wall');      break;
      case 'b': case 'B': setMode('boundary');  break;
      case 'p': case 'P': setMode('partition'); break;
      case 'd': case 'D': setMode('desk');      break;
      case 'f': case 'F': fitToScreen();         break;
      case 'g': case 'G':
        ed.snapGrid = !ed.snapGrid;
        document.getElementById('ed-grid-rect')?.style.setProperty('display', ed.snapGrid ? '' : 'none');
        edToast('Сетка: ' + (ed.snapGrid ? 'вкл' : 'выкл'), 'info');
        if (isDeskBlockMode() && ed.deskTool.preview) {
          rebuildDeskBlockPreview(ed.deskTool.preview.current || ed.deskTool.preview.anchor);
        }
        updateStatusBar();
        break;
      case 'Escape':
        if (!$el('ed-history-overlay')?.classList.contains('ed-hidden')) {
          closeHistoryModal();
          break;
        }
        if (ed.bgAdjust.active) {
          setBackgroundAdjustMode(false);
          break;
        }
        if (cancelDeskBlockPreview()) break;
        if (ed.drawing) { ed.drawing = null; const l = _layer('draw'); if (l) l.innerHTML = ''; }
        else if (ed.marquee) { ed.marquee = null; renderSelection(); }
        else deselect();
        break;
      case 'Enter':
        if (commitDeskBlockPreview()) break;
        if (ed.drawing) finishDrawing(ed.mode === 'boundary');
        break;
      case 'Delete': case 'Backspace':
        if (deleteSelectedDesks()) {
          break;
        }
        if (ed.selType) {
          deleteStructEl(ed.selType, ed.selId);
        }
        break;
    }
  });

  document.addEventListener('keyup', e => {
    if (e.key === 'Alt') {
      ed.altSnapOff = false;
      if (isDeskBlockMode() && ed.deskTool.preview) {
        rebuildDeskBlockPreview(ed.deskTool.preview.current || ed.deskTool.preview.anchor);
      }
      updateStatusBar();
      return;
    }
    if (e.key === 'Shift') {
      ed.shiftFine = false;
      if (isDeskBlockMode() && ed.deskTool.preview) {
        rebuildDeskBlockPreview(ed.deskTool.preview.current || ed.deskTool.preview.anchor);
      }
      updateStatusBar();
      return;
    }
    if (e.code === 'Space') {
      ed.spaceDown = false;
      if (ed.spacePanning) { ed.spacePanning = false; ed.spacePanStart = null; }
    }
  });

  window.addEventListener('blur', () => {
    if (!ed.altSnapOff && !ed.shiftFine) return;
    ed.altSnapOff = false;
    ed.shiftFine = false;
    if (isDeskBlockMode() && ed.deskTool.preview) {
      rebuildDeskBlockPreview(ed.deskTool.preview.current || ed.deskTool.preview.anchor);
    }
    updateStatusBar();
  });
}

/* ── Collapse panels ────────────────────────────────────────────────────────── */
function initCollapsePanels() {
  const body = $el('ed-body');
  const left = $el('ed-left');
  const right = $el('ed-right');
  const leftBtn = $el('ed-left-collapse');
  const rightBtn = $el('ed-right-collapse');
  const leftExpand = $el('ed-left-expand');
  const rightExpand = $el('ed-right-expand');

  const state = {
    left: localStorage.getItem(PANEL_LEFT_KEY) === '1',
    right: localStorage.getItem(PANEL_RIGHT_KEY) === '1',
  };

  const apply = (persist) => {
    left?.classList.toggle('collapsed', state.left);
    right?.classList.toggle('collapsed', state.right);
    body?.classList.toggle('left-collapsed', state.left);
    body?.classList.toggle('right-collapsed', state.right);

    leftExpand?.classList.toggle('ed-hidden', !state.left);
    rightExpand?.classList.toggle('ed-hidden', !state.right);

    if (leftBtn) {
      leftBtn.textContent = '◀';
      leftBtn.setAttribute('aria-expanded', String(!state.left));
      leftBtn.title = 'Скрыть инвентарь';
    }
    if (rightBtn) {
      rightBtn.textContent = '▶';
      rightBtn.setAttribute('aria-expanded', String(!state.right));
      rightBtn.title = 'Скрыть свойства';
    }
    if (leftExpand) leftExpand.setAttribute('aria-expanded', String(!state.left));
    if (rightExpand) rightExpand.setAttribute('aria-expanded', String(!state.right));

    if (persist !== false) {
      localStorage.setItem(PANEL_LEFT_KEY, state.left ? '1' : '0');
      localStorage.setItem(PANEL_RIGHT_KEY, state.right ? '1' : '0');
    }
  };

  leftBtn?.addEventListener('click', () => {
    state.left = true;
    apply(true);
  });
  rightBtn?.addEventListener('click', () => {
    state.right = true;
    apply(true);
  });
  leftExpand?.addEventListener('click', () => {
    state.left = false;
    apply(true);
  });
  rightExpand?.addEventListener('click', () => {
    state.right = false;
    apply(true);
  });

  window.addEventListener('resize', () => apply(false));
  document.addEventListener('admin:tab-change', e => {
    if (e?.detail?.tab === 'editor') apply(false);
  });

  apply(false);
}

/* ── Floor select population ────────────────────────────────────────────────── */
function populateEdFloorSelect(floors, offices) {
  const sel = $el('ed-floor-select');
  if (!sel) return;
  const cur = sel.value;
  sel.innerHTML = '<option value="">Выберите этаж…</option>';
  for (const f of (floors || [])) {
    const o = (offices || []).find(x => x.id === f.office_id);
    const opt = document.createElement('option');
    opt.value = f.id;
    opt.textContent = f.name + (o ? ' — ' + o.name : '');
    sel.appendChild(opt);
  }
  if (cur) sel.value = cur;
}

function initDeskBulkControls() {
  const apply = () => {
    const nextPlaceMode = $el('ed-desk-place-mode')?.value === 'block' ? 'block' : 'single';
    const wasBlock = ed.deskTool.placeMode === 'block';

    ed.deskTool.placeMode = nextPlaceMode;
    ed.deskTool.pattern = $el('ed-desk-block-pattern')?.value === 'double' ? 'double' : 'rows';
    ed.deskTool.axis = $el('ed-desk-block-axis')?.value === 'vertical' ? 'vertical' : 'horizontal';
    ed.deskTool.seatsPerRow = clampInt($el('ed-desk-seats-per-row')?.value, 1, 100, ed.deskTool.seatsPerRow || 6);
    ed.deskTool.rowCount = clampInt($el('ed-desk-row-count')?.value, 1, 50, ed.deskTool.rowCount || 2);
    ed.deskTool.pairCount = clampInt($el('ed-desk-pair-count')?.value, 1, 25, ed.deskTool.pairCount || 1);

    if (wasBlock && ed.deskTool.placeMode !== 'block') {
      cancelDeskBlockPreview();
    } else if (ed.deskTool.placeMode === 'block' && ed.deskTool.preview) {
      rebuildDeskBlockPreview(ed.deskTool.preview.current || ed.deskTool.preview.anchor);
    }

    syncDeskBulkControls();
    updateStatusBar();
    renderDrawing();
  };

  ['ed-desk-place-mode', 'ed-desk-block-pattern', 'ed-desk-block-axis', 'ed-desk-seats-per-row', 'ed-desk-row-count', 'ed-desk-pair-count']
    .forEach(id => {
      $el(id)?.addEventListener('change', apply);
      $el(id)?.addEventListener('input', apply);
    });

  syncDeskBulkControls();
}

/* ── Main init ──────────────────────────────────────────────────────────────── */
function initFloorEditor() {
  // Floor select
  $el('ed-floor-select')?.addEventListener('change', function() {
    edLoadFloor(this.value || null);
  });

  // Mode buttons
  document.querySelectorAll('.ed-mode-btn').forEach(btn => {
    btn.addEventListener('click', () => setMode(btn.dataset.mode));
  });

  // Toolbar actions
  $el('ed-lock-btn')?.addEventListener('click', () => {
    if (ed.locked) {
      if (isLockOwnedByMe()) releaseLock();
      return;
    }
    acquireLock();
  });
  $el('ed-fit-btn')?.addEventListener('click', fitToScreen);
  $el('ed-sync-bg-btn')?.addEventListener('click', syncCanvasToBackground);
  $el('ed-bg-adjust-btn')?.addEventListener('click', toggleBackgroundAdjustMode);
  $el('ed-clear-bg-btn')?.addEventListener('click', clearBackground);
  $el('ed-sync-desks-btn')?.addEventListener('click', syncDesksFromLayout);
  $el('ed-grid-btn')?.addEventListener('click', () => {
    ed.snapGrid = !ed.snapGrid;
    document.getElementById('ed-grid-rect')?.style.setProperty('display', ed.snapGrid ? '' : 'none');
    $el('ed-grid-btn')?.classList.toggle('active', ed.snapGrid);
    if (isDeskBlockMode() && ed.deskTool.preview) {
      rebuildDeskBlockPreview(ed.deskTool.preview.current || ed.deskTool.preview.anchor);
    }
    updateStatusBar();
  });
  $el('ed-save-btn')?.addEventListener('click', edSaveDraft);
  $el('ed-publish-btn')?.addEventListener('click', edPublish);
  $el('ed-discard-btn')?.addEventListener('click', edDiscard);
  $el('ed-import-btn')?.addEventListener('click', () => $el('ed-import-overlay')?.classList.remove('ed-hidden'));
  $el('ed-history-btn')?.addEventListener('click', edShowHistory);

  // Zoom buttons
  $el('ed-zoom-in')?.addEventListener('click',    () => zoomBy(0.9));
  $el('ed-zoom-out')?.addEventListener('click',   () => zoomBy(1 / 0.9));
  $el('ed-zoom-reset')?.addEventListener('click', fitToScreen);

  // SVG canvas
  const svg = _svg();
  if (svg) {
    svg.addEventListener('pointerdown', onSvgPointerDown);
    svg.addEventListener('pointermove', onSvgPointerMove);
    svg.addEventListener('pointerup',   onSvgPointerUp);
    svg.addEventListener('click',       onSvgClick);
    svg.addEventListener('dblclick',    onSvgDblClick);
    svg.addEventListener('wheel',       onWheelZoom, { passive: false });
  }

  // Object search
  $el('ed-obj-search')?.addEventListener('input', renderObjectList);

  // Import modal
  $el('ed-import-close')?.addEventListener('click',  closeImportModal);
  $el('ed-import-cancel')?.addEventListener('click', closeImportModal);
  $el('ed-import-apply')?.addEventListener('click',  applyImport);
  $el('ed-import-browse')?.addEventListener('click', () => $el('ed-import-file')?.click());
  $el('ed-import-file')?.addEventListener('change', function() {
    if (this.files[0]) { handleImportFile(this.files[0]); this.value = ''; }
  });

  const dropZone = $el('ed-import-drop');
  if (dropZone) {
    dropZone.addEventListener('dragover', e => { e.preventDefault(); dropZone.classList.add('over'); });
    dropZone.addEventListener('dragleave', () => dropZone.classList.remove('over'));
    dropZone.addEventListener('drop', e => {
      e.preventDefault(); dropZone.classList.remove('over');
      const file = e.dataTransfer.files[0];
      if (file) handleImportFile(file);
    });
  }

  // History modal
  $el('ed-history-close')?.addEventListener('click', closeHistoryModal);
  $el('ed-history-cancel')?.addEventListener('click', closeHistoryModal);
  $el('ed-history-overlay')?.addEventListener('click', e => {
    if (e.target?.id === 'ed-history-overlay') closeHistoryModal();
  });

  // Release lock on page close
  window.addEventListener('beforeunload', () => { if (ed.locked && ed.floorId && isLockOwnedByMe()) releaseLock(); });

  initPropsListeners();
  initDeskBulkControls();
  initEditorKeyboard();
  initCollapsePanels();
  updateEditorUI();
  updateStatusBar();
  updateEditorKpis();
  updateLockUI();
}
