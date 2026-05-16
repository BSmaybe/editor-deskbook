/**
 * Floor Editor v2 — SVG-first canonical layout editor
 * Modes: select | pan | wall | boundary | partition | door | desk | component
 * No external dependencies.
 */

'use strict';

/* ── Constants ──────────────────────────────────────────────────────────────── */
const API = '/api';
const NS  = 'http://www.w3.org/2000/svg';

const STRUCT_COLORS = {
  wall:      '#2f343b',
  boundary:  '#1d4ed8',
  partition: '#4b5563',
  door:      '#1f2937',
};
const DEFAULT_ZONE_COLOR = STRUCT_COLORS.boundary;
const STRUCT_OPACITY = { wall: 1, boundary: 0.15, partition: 0.7, door: 1 };
const MAX_LAYOUT_DESKS = 2000;
const PX_CLOSE_THRESHOLD = 14;
const MARQUEE_MIN_PX = 4;
const OBJECT_HIT_PX = 14;
const DEFAULT_ZONE_LABEL_SIZE = 18;
const DRAW_ANGLE_STEP_DEG = 45;
const PANEL_LEFT_KEY = 'editor_left_collapsed';
const PANEL_RIGHT_KEY = 'editor_right_collapsed';
const DESK_SIZE_PRESETS = {
  small: 0.7,
  normal: 1,
  large: 1.4,
};

const DESK_COLORS = {
  flex:     { fill: '#dbeafe', stroke: '#2563eb' },
  fixed:    { fill: '#fef3c7', stroke: '#d97706' },
  disabled: { fill: '#f1f5f9', stroke: '#94a3b8' },
  occupied: { fill: '#fee2e2', stroke: '#dc2626' },
};

const MODE_HINTS = {
  select:    'Клик — выбор; Shift+клик/рамка — мультивыбор объектов; тащи — перемещение; круглая ручка — поворот; Q/E — шаг поворота; Пробел+тащи — рука',
  pan:       'Тащи для панорамирования; колесо — зум',
  wall:      'Клик — добавить точку; Shift — угол 45°; Enter/двойной клик — завершить; Esc — отменить',
  boundary:  'Клик — точка; Shift — угол 45°; клик рядом с первой — замкнуть; Enter — замкнуть; Esc — отменить',
  partition: 'Клик — точка; Shift — угол 45°; Enter — завершить; Esc — отменить',
  door:      'Клик — точка; Shift — угол 45°; Enter/двойной клик — завершить; Esc — отменить',
  desk:      'Клик — поставить рабочее место; для массовой расстановки выберите "Блок" в панели ниже',
  component: 'Выберите reusable/custom компонент; клик — поставить объект на карту; создание компонентов вынесено во вкладку "Компоненты"',
};
const STRUCT_TYPES = ['wall', 'boundary', 'partition', 'door'];
const BUILTIN_COMPONENTS = [
  { id: 'workplace-desk-chair', label: 'Рабочее место: стол + кресло', asset_type: 'workplace', source: 'system', view_box: [0, 0, 140, 125], default_w: 140, default_h: 125 },
  { id: 'chair', label: 'Кресло', asset_type: 'chair', source: 'system', view_box: [0, 0, 64, 64], default_w: 64, default_h: 64 },
  { id: 'desk-short', label: 'Короткий стол', asset_type: 'desk', source: 'system', view_box: [0, 0, 100, 60], default_w: 100, default_h: 60 },
  { id: 'desk-long', label: 'Длинный стол', asset_type: 'desk', source: 'system', view_box: [0, 0, 160, 60], default_w: 160, default_h: 60 },
  { id: 'meeting-table', label: 'Переговорный стол', asset_type: 'meeting_table', source: 'system', view_box: [0, 0, 140, 90], default_w: 140, default_h: 90 },
  { id: 'conference-chair', label: 'Конференц-кресло', asset_type: 'chair', source: 'system', view_box: [0, 0, 64, 64], default_w: 64, default_h: 64 },
  { id: 'conference-set', label: 'Конференц-сет', asset_type: 'conference_set', source: 'system', view_box: [0, 0, 220, 150], default_w: 220, default_h: 150 },
];
const BUILTIN_COMPONENT_IDS = new Set(BUILTIN_COMPONENTS.map((s) => s.id));
const LAYOUT_SYMBOLS = BUILTIN_COMPONENTS.map((c) => ({ id: c.id, label: c.label, assetType: c.asset_type }));
const LAYOUT_SYMBOL_IDS = new Set(LAYOUT_SYMBOLS.map((s) => s.id));
const ASSET_TYPES = new Set(['workplace', 'desk', 'chair', 'meeting_table', 'conference_set', 'asset']);
const COMPONENT_ID_RE = /^[A-Za-z_][A-Za-z0-9_.:-]{0,119}$/;
const INVENTORY_FILTERS = [
  { id: 'workplace', label: 'Раб.места', color: '#2563eb' },
  { id: 'desk', label: 'Столы', color: '#8b5e34' },
  { id: 'chair', label: 'Стулья', color: '#64748b' },
  { id: 'meeting_table', label: 'Переговорные', color: '#0f766e' },
  { id: 'conference_set', label: 'Конф.сеты', color: '#7c3aed' },
  { id: 'asset', label: 'Assets', color: '#64748b' },
  { id: 'boundary', label: 'Границы', color: STRUCT_COLORS.boundary },
  { id: 'wall', label: 'Стены', color: STRUCT_COLORS.wall },
  { id: 'partition', label: 'Перегородки', color: STRUCT_COLORS.partition },
  { id: 'door', label: 'Двери', color: STRUCT_COLORS.door },
];
const SVG_RENDER_TAGS = new Set(['g', 'path', 'rect', 'circle', 'ellipse', 'line', 'polyline', 'polygon', 'text', 'use']);
const SVG_RENDER_ATTRS = new Set([
  'class', 'id', 'd', 'x', 'y', 'width', 'height', 'rx', 'ry', 'cx', 'cy', 'r',
  'x1', 'y1', 'x2', 'y2', 'points', 'transform', 'fill', 'stroke', 'stroke-width',
  'stroke-linecap', 'stroke-linejoin', 'stroke-dasharray', 'fill-opacity',
  'stroke-opacity', 'opacity', 'font-size', 'font-family', 'font-weight',
  'text-anchor', 'dominant-baseline', 'href', 'xlink:href',
]);

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
    inventoryVisible: Object.fromEntries(INVENTORY_FILTERS.map((item) => [item.id, true])),
    altSnapOff: false,
    shiftFine: false,
    shiftDown: false,
    deskTool: {
      componentId: 'workplace-desk-chair',
      sizePreset: 'normal', // small | normal | large
      placeMode: 'single', // single | block
      pattern: 'rows',     // rows | double
      axis: 'horizontal',  // horizontal | vertical
      deskW: null,
      deskH: null,
      seatsPerRow: 6,
      rowCount: 2,
      pairCount: 1,
      preview: null,       // transient preview for block placement
    },
    componentTool: {
      componentId: 'chair',
      objectW: null,
      objectH: null,
    },

    // Drawing (wall/boundary/partition)
    drawing: null,   // { type, pts: [[x,y],...], rubberPt: [x,y] }

    // Selection
    selType: null,   // 'desk' | 'wall' | 'boundary' | 'partition' | 'door'
    selId:   null,
    multiDeskIds: [],
    multiStructKeys: [],
    marquee: null,   // { pointerId, start:{x,y}, current:{x,y}, append:boolean }
    dragGroup: null, // { pointerId, startPt:{x,y}, desks:[...], structs:[...], moved }
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

function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function safeComponentId(value) {
  const raw = String(value || '').trim();
  return COMPONENT_ID_RE.test(raw) ? raw : null;
}

function slugifyComponentId(value, fallback = 'custom-component') {
  let slug = String(value || fallback)
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_.:-]+/g, '-')
    .replace(/^-+|-+$/g, '');
  if (!slug) slug = fallback;
  if (!/^[a-z_]/.test(slug)) slug = `custom-${slug}`;
  return slug.slice(0, 120);
}

function normalizeComponentRecord(component) {
  const id = safeComponentId(component?.id);
  if (!id) return null;
  const viewBox = Array.isArray(component.view_box) && component.view_box.length === 4
    ? component.view_box.map((n) => Number(n))
    : [0, 0, 100, 60];
  const vb = viewBox.every(Number.isFinite) && viewBox[2] > 0 && viewBox[3] > 0 ? viewBox : [0, 0, 100, 60];
  const rawAssetType = String(component.asset_type || component.assetType || 'asset').trim();
  const assetType = ASSET_TYPES.has(rawAssetType) ? rawAssetType : 'asset';
  const source = component.source === 'custom' || !BUILTIN_COMPONENT_IDS.has(id) ? 'custom' : 'system';
  return {
    id,
    label: String(component.label || id).slice(0, 120),
    asset_type: assetType,
    source,
    view_box: vb,
    default_w: clampNum(component.default_w ?? component.defaultW, 1, 10000, vb[2]),
    default_h: clampNum(component.default_h ?? component.defaultH, 1, 10000, vb[3]),
    svg_markup: source === 'custom' ? String(component.svg_markup || component.svgMarkup || '') : null,
  };
}

function normalizeLayoutComponents(components) {
  const out = BUILTIN_COMPONENTS.map((c) => ({ ...c }));
  const seen = new Set(out.map((c) => c.id));
  (Array.isArray(components) ? components : []).forEach((item) => {
    const component = normalizeComponentRecord(item);
    if (!component || component.source !== 'custom') return;
    if (BUILTIN_COMPONENT_IDS.has(component.id) || seen.has(component.id)) return;
    if (!component.svg_markup || !isSafeSvgMarkup(component.svg_markup)) return;
    out.push(component);
    seen.add(component.id);
  });
  return out;
}

function componentCatalog() {
  const globals = typeof getGlobalComponents === 'function' ? getGlobalComponents() : [];
  const out = BUILTIN_COMPONENTS.map((c) => ({ ...c }));
  const byId = new Map(out.map((component) => [component.id, component]));
  [...(ld?.components || []), ...globals].forEach((item) => {
    const component = normalizeComponentRecord(item);
    if (!component || component.source !== 'custom') return;
    if (BUILTIN_COMPONENT_IDS.has(component.id)) return;
    if (!component.svg_markup || !isSafeSvgMarkup(component.svg_markup)) return;
    byId.set(component.id, component);
  });
  const custom = Array.from(byId.values()).filter((component) => component.source === 'custom');
  return [...out, ...custom];
}

function ensureLayoutComponent(component) {
  if (!ld || !component) return false;
  const normalized = normalizeComponentRecord({ ...component, source: 'custom' });
  if (!normalized || normalized.source !== 'custom') return false;
  if (BUILTIN_COMPONENT_IDS.has(normalized.id)) return false;
  if (!normalized.svg_markup || !isSafeSvgMarkup(normalized.svg_markup)) return false;

  const previous = (ld.components || []).find((item) => item.id === normalized.id);
  const nextComponents = (ld.components || []).filter((item) => item.id !== normalized.id);
  ld.components = normalizeLayoutComponents([...nextComponents, normalized]);
  const next = ld.components.find((item) => item.id === normalized.id);
  return JSON.stringify(previous || null) !== JSON.stringify(next || null);
}

function componentForId(value, fallback = 'desk-short') {
  const raw = String(value || '').trim();
  const catalog = componentCatalog();
  return catalog.find((component) => component.id === raw)
    || catalog.find((component) => component.id === fallback)
    || BUILTIN_COMPONENTS.find((component) => component.id === fallback)
    || BUILTIN_COMPONENTS[0];
}

function normalizeLayoutSymbolId(value) {
  return componentForId(value, 'desk-short').id;
}

function assetTypeForSymbol(symbolId) {
  return componentForId(symbolId, 'desk-short')?.asset_type || 'asset';
}

function normalizeAssetType(value, symbolId = null) {
  const raw = String(value || '').trim();
  if (ASSET_TYPES.has(raw)) return raw;
  return assetTypeForSymbol(symbolId);
}

function isWorkplaceObject(item) {
  return (item?.asset_type || 'workplace') === 'workplace';
}

function inventoryTypeForDesk(item) {
  if (isWorkplaceObject(item)) return 'workplace';
  const raw = String(item?.asset_type || 'asset').trim();
  return ASSET_TYPES.has(raw) ? raw : 'asset';
}

function isInventoryVisible(type) {
  if (!ed.inventoryVisible) ed.inventoryVisible = Object.fromEntries(INVENTORY_FILTERS.map((item) => [item.id, true]));
  return ed.inventoryVisible[type] !== false;
}

function inventoryCounts() {
  const counts = Object.fromEntries(INVENTORY_FILTERS.map((item) => [item.id, 0]));
  for (const desk of (ld?.desks || [])) {
    const type = inventoryTypeForDesk(desk);
    counts[type] = (counts[type] || 0) + 1;
  }
  counts.wall = (ld?.walls || []).length;
  counts.boundary = (ld?.boundaries || []).length;
  counts.partition = (ld?.partitions || []).length;
  counts.door = (ld?.doors || []).length;
  return counts;
}

function syncInventoryFilters() {
  const wrap = $el('ed-inventory-filters');
  if (!wrap) return;
  const counts = inventoryCounts();
  wrap.innerHTML = INVENTORY_FILTERS.map((item) => {
    const checked = isInventoryVisible(item.id) ? 'checked' : '';
    return `<label class="ed-inventory-filter" title="Показать/скрыть ${escapeHtml(item.label)}">
      <input type="checkbox" data-inventory-filter="${escapeHtml(item.id)}" ${checked}>
      <span>${escapeHtml(item.label)}</span>
      <span class="ed-inventory-count">${counts[item.id] || 0}</span>
    </label>`;
  }).join('');
  wrap.querySelectorAll('input[data-inventory-filter]').forEach((input) => {
    input.addEventListener('change', () => {
      const type = input.dataset.inventoryFilter;
      ed.inventoryVisible[type] = !!input.checked;
      renderStructure();
      renderDesks();
      renderSelection();
      renderObjectList();
    });
  });
}

function isSafeSvgMarkup(markup) {
  const raw = String(markup || '');
  const lower = raw.toLowerCase();
  if (!raw.trim()) return false;
  if (/<\s*(script|foreignobject|style)\b/i.test(raw)) return false;
  if (/\son[a-z]+\s*=/i.test(raw)) return false;
  if (/\sstyle\s*=/i.test(raw)) return false;
  if (lower.includes('javascript:')) return false;
  if (/\s(?:href|xlink:href)\s*=\s*['"]?(?:https?:|\/\/|data:)/i.test(raw)) return false;
  const hrefRe = /\s(?:href|xlink:href)\s*=\s*['"]?([^'"\s>]+)/ig;
  let hrefMatch;
  while ((hrefMatch = hrefRe.exec(raw))) {
    if (!/^#[A-Za-z_][A-Za-z0-9_.:-]{0,119}$/.test(hrefMatch[1])) return false;
  }
  const tagRe = /<\/?\s*([A-Za-z][A-Za-z0-9:_-]*)/g;
  let match;
  while ((match = tagRe.exec(raw))) {
    const tag = match[1].split(':').pop().toLowerCase();
    if (!SVG_RENDER_TAGS.has(tag)) return false;
  }
  return true;
}

function normalizeEntityId(value, fallback = null) {
  const raw = String(value || '').trim();
  return raw ? raw.slice(0, 120) : fallback;
}

function _degToRad(deg) {
  return Number(deg || 0) * Math.PI / 180;
}

function normalizeDeskRotation(value) {
  let ang = Number(value);
  if (!Number.isFinite(ang)) return 0;
  ang = ((ang + 180) % 360 + 360) % 360 - 180;
  return Math.abs(ang) < 1e-6 ? 0 : ang;
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

function isDrawMode(mode = ed.mode) {
  return ['wall', 'boundary', 'partition', 'door'].includes(mode);
}

function _toXYPoint(pt) {
  if (!pt) return null;
  const x = Number(Array.isArray(pt) ? pt[0] : pt.x);
  const y = Number(Array.isArray(pt) ? pt[1] : pt.y);
  if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
  return { x, y };
}

function getConstrainedDrawPoint(basePt, pointerPt, opts = {}) {
  const ptr = _toXYPoint(pointerPt);
  if (!ptr) return [0, 0];

  const angleLock = !!opts.angleLock;
  if (!angleLock) return [snapV(ptr.x), snapV(ptr.y)];

  const base = _toXYPoint(basePt);
  if (!base) return [snapV(ptr.x), snapV(ptr.y)];

  const dx = ptr.x - base.x;
  const dy = ptr.y - base.y;
  const len = Math.hypot(dx, dy);
  if (len <= 1e-9) return [base.x, base.y];

  const stepDeg = Number.isFinite(Number(opts.angleStepDeg))
    ? Number(opts.angleStepDeg)
    : DRAW_ANGLE_STEP_DEG;
  const stepRad = Math.max(1, stepDeg) * Math.PI / 180;
  const rawAngle = Math.atan2(dy, dx);
  const lockedAngle = Math.round(rawAngle / stepRad) * stepRad;

  let dist = len;
  if (!ed.altSnapOff && ed.snapGrid) {
    const gridStep = Math.max(0.1, Number(ed.gridSize || 10));
    dist = Math.round(len / gridStep) * gridStep;
  }

  return [
    base.x + Math.cos(lockedAngle) * dist,
    base.y + Math.sin(lockedAngle) * dist,
  ];
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

function layoutStrokeScale(vbWidth) {
  const w = Number(vbWidth);
  if (!Number.isFinite(w) || w <= 0) return 1;
  return Math.max(0.2, Math.min(8, w * 0.001));
}

function layoutStrokeWidth(kind, thick, vbWidth) {
  const base = Number.isFinite(Number(thick)) ? Number(thick) : (
    kind === 'wall' ? 4 :
    kind === 'partition' ? 3 :
    kind === 'door' ? 2.2 :
    2
  );
  const scale = layoutStrokeScale(vbWidth);
  if (kind === 'boundary') return Math.max(1, base * scale * 0.4);
  return Math.max(1, base * scale);
}

function clampInt(v, min, max, fallback) {
  if (v === null || v === undefined || v === '') return fallback;
  const n = parseInt(v, 10);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(min, Math.min(max, n));
}

function clampNum(v, min, max, fallback) {
  if (v === null || v === undefined || v === '') return fallback;
  const n = Number(v);
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

function takeNextObjectLabel(used, component) {
  if ((component?.asset_type || 'workplace') === 'workplace') return takeNextDeskLabel(used);
  return String(component?.label || component?.id || 'Asset').slice(0, 40);
}

function baseDeskSize() {
  if (!ld) return { w: 28, h: 16 };
  const w = Math.max(8, ld.vb[2] * 0.028);
  const h = Math.max(6, ld.vb[3] * 0.016);
  return { w, h };
}

function deskSizeForPreset(preset = 'normal') {
  const base = baseDeskSize();
  const factor = DESK_SIZE_PRESETS[preset] || DESK_SIZE_PRESETS.normal;
  return {
    w: Math.max(4, base.w * factor),
    h: Math.max(4, base.h * factor),
  };
}

function setDeskSizePreset(preset = 'normal') {
  const nextPreset = DESK_SIZE_PRESETS[preset] ? preset : 'normal';
  const size = deskSizeForPreset(nextPreset);
  ed.deskTool.sizePreset = nextPreset;
  ed.deskTool.deskW = size.w;
  ed.deskTool.deskH = size.h;
  _v('ed-desk-size-preset', nextPreset);
  _v('ed-desk-width', Math.round(size.w * 10) / 10);
  _v('ed-desk-height', Math.round(size.h * 10) / 10);
  if (isDeskBlockMode() && ed.deskTool.preview) {
    rebuildDeskBlockPreview(ed.deskTool.preview.current || ed.deskTool.preview.anchor);
  }
}

function defaultDeskSize(opts = {}) {
  const base = baseDeskSize();
  const tool = opts.tool || (ed.mode === 'component' ? 'component' : 'desk');
  const componentId = opts.componentId || (
    tool === 'component'
      ? ed?.componentTool?.componentId
      : ed?.deskTool?.componentId
  ) || 'workplace-desk-chair';
  const component = componentForId(componentId, tool === 'component' ? 'chair' : 'workplace-desk-chair');
  const componentBase = {
    w: tool === 'desk' ? base.w : Number(component?.default_w || component?.defaultW || base.w),
    h: tool === 'desk' ? base.h : Number(component?.default_h || component?.defaultH || base.h),
  };
  const maxW = Math.max(120, base.w * 8);
  const maxH = Math.max(90, base.h * 8);
  const configuredW = tool === 'component' ? ed?.componentTool?.objectW : ed?.deskTool?.deskW;
  const configuredH = tool === 'component' ? ed?.componentTool?.objectH : ed?.deskTool?.deskH;
  return {
    w: clampNum(configuredW, 4, maxW, Number.isFinite(componentBase.w) ? componentBase.w : base.w),
    h: clampNum(configuredH, 4, maxH, Number.isFinite(componentBase.h) ? componentBase.h : base.h),
  };
}

function makeDeskRecord(rect, label, opts = {}) {
  const id = uid();
  const component = componentForId(opts.componentId || ed?.deskTool?.componentId || 'workplace-desk-chair', 'workplace-desk-chair');
  const componentId = component?.id || 'desk-short';
  const assetType = normalizeAssetType(opts.assetType || component?.asset_type, componentId);
  const isWorkplace = assetType === 'workplace';
  return {
    id, label, inventory_number: null, name: null, team: null, dept: null,
    building_id: ld?.building_id || null,
    storey_id: ld?.storey_id || null,
    zone_id: ld?.zone_id || null,
    workplace_id: isWorkplace ? id : null,
    component_id: componentId,
    symbol_id: componentId,
    asset_type: assetType,
    bookable: isWorkplace, fixed: false, assigned_to: null, status: 'available',
    x: rect.x, y: rect.y, w: rect.w, h: rect.h, r: 0, locked: false,
  };
}

function rectsOverlap(a, b) {
  return a.x < b.x + b.w && a.x + a.w > b.x &&
         a.y < b.y + b.h && a.y + a.h > b.y;
}

function isDeskBlockMode() {
  return ed.mode === 'desk' && ed.deskTool.placeMode === 'block';
}

function componentOptionLabel(component) {
  const type = component.asset_type === 'workplace' ? 'workplace' : component.asset_type.replace(/_/g, '-');
  return `${component.label} (${type})`;
}

function syncComponentSelectElement(select, selectedId) {
  if (!select) return;
  const catalog = componentCatalog();
  const selected = componentForId(selectedId || ed?.deskTool?.componentId || 'workplace-desk-chair', 'workplace-desk-chair')?.id;
  select.innerHTML = '';
  const groups = [
    { label: 'Готовые компоненты', items: catalog.filter((component) => component.source !== 'custom') },
    { label: 'Custom компоненты', items: catalog.filter((component) => component.source === 'custom') },
  ];
  groups.forEach((group) => {
    if (!group.items.length) return;
    const optgroup = document.createElement('optgroup');
    optgroup.label = group.label;
    group.items.forEach((component) => {
      const option = document.createElement('option');
      option.value = component.id;
      option.textContent = componentOptionLabel(component);
      optgroup.appendChild(option);
    });
    select.appendChild(optgroup);
  });
  if (selected) select.value = selected;
}

function syncComponentPalette() {
  if (!ed.componentTool) ed.componentTool = { componentId: 'chair', objectW: null, objectH: null };
  const current = componentForId(ed.componentTool.componentId || 'chair', 'chair');
  if (current) ed.componentTool.componentId = current.id;
  syncComponentSelectElement($el('ed-component-place-select'), ed.componentTool.componentId);
  syncComponentSelectElement($el('ep-symbol'), ed.selType === 'desk' ? selectedDeskRecords()[0]?.component_id : ed.componentTool.componentId);
  [$el('ed-component-delete-btn'), $el('ed-component-library-delete')].forEach((deleteBtn) => {
    if (!deleteBtn || !current) return;
    const used = (ld?.desks || []).some((item) => (item.component_id || item.symbol_id) === current.id);
    deleteBtn.disabled = current.source !== 'custom' || used;
    deleteBtn.title = current.source !== 'custom'
      ? 'Системные компоненты нельзя удалить'
      : used
        ? 'Компонент используется на карте'
        : 'Удалить custom-компонент';
  });
  renderComponentLibrary();
}

function syncComponentPlaceControls() {
  const panel = $el('ed-component-place-panel');
  const show = ed.mode === 'component';
  panel?.classList.toggle('ed-hidden', !show);
  if (!show) return;

  if (!ed.componentTool) ed.componentTool = { componentId: 'chair', objectW: null, objectH: null };
  const component = componentForId(ed.componentTool.componentId || 'chair', 'chair');
  if (component) {
    ed.componentTool.componentId = component.id;
    ed.componentTool.objectW = clampNum(component.default_w ?? component.defaultW, 4, 10000, 100);
    ed.componentTool.objectH = clampNum(component.default_h ?? component.defaultH, 4, 10000, 60);
  }
  syncComponentPalette();

  const note = $el('ed-component-place-note');
  if (note && component) {
    const type = component.asset_type === 'workplace' ? 'workplace' : String(component.asset_type || 'asset').replace(/_/g, '-');
    note.textContent = `Компонент: ${component.label} (${type}). Клик по карте поставит объект. Новые symbols создаются во вкладке "Компоненты".`;
  }
}

function syncDeskBulkControls() {
  const panel = $el('ed-desk-bulk-panel');
  const show = ed.mode === 'desk';
  panel?.classList.toggle('ed-hidden', !show);
  if (!show) return;
  ed.deskTool.componentId = 'workplace-desk-chair';

  const baseSize = baseDeskSize();
  const maxW = Math.max(120, baseSize.w * 8);
  const maxH = Math.max(90, baseSize.h * 8);
  const defaultSize = defaultDeskSize();
  if (!DESK_SIZE_PRESETS[ed.deskTool.sizePreset]) ed.deskTool.sizePreset = 'normal';
  ed.deskTool.deskW = clampNum(ed.deskTool.deskW, 4, maxW, defaultSize.w);
  ed.deskTool.deskH = clampNum(ed.deskTool.deskH, 4, maxH, defaultSize.h);
  ed.deskTool.seatsPerRow = clampInt(ed.deskTool.seatsPerRow, 1, 100, 6);
  ed.deskTool.rowCount = clampInt(ed.deskTool.rowCount, 1, 50, 2);
  ed.deskTool.pairCount = clampInt(ed.deskTool.pairCount, 1, 25, 1);
  if (!['single', 'block'].includes(ed.deskTool.placeMode)) ed.deskTool.placeMode = 'single';
  if (!['rows', 'double'].includes(ed.deskTool.pattern)) ed.deskTool.pattern = 'rows';
  if (!['horizontal', 'vertical'].includes(ed.deskTool.axis)) ed.deskTool.axis = 'horizontal';

  _v('ed-desk-size-preset', ed.deskTool.sizePreset);
  _v('ed-desk-place-mode', ed.deskTool.placeMode);
  _v('ed-desk-block-pattern', ed.deskTool.pattern);
  _v('ed-desk-block-axis', ed.deskTool.axis);
  _v('ed-desk-width', Math.round(ed.deskTool.deskW * 10) / 10);
  _v('ed-desk-height', Math.round(ed.deskTool.deskH * 10) / 10);
  _v('ed-desk-seats-per-row', ed.deskTool.seatsPerRow);
  _v('ed-desk-row-count', ed.deskTool.rowCount);
  _v('ed-desk-pair-count', ed.deskTool.pairCount);

  $el('ed-desk-rows-field')?.classList.toggle('ed-hidden', ed.deskTool.pattern !== 'rows');
  $el('ed-desk-pairs-field')?.classList.toggle('ed-hidden', ed.deskTool.pattern !== 'double');

  const note = $el('ed-desk-bulk-note');
  if (note) {
    const sizeNote = `(${Math.round(ed.deskTool.deskW)}×${Math.round(ed.deskTool.deskH)})`;
    if (ed.deskTool.placeMode === 'single') {
      note.textContent = `Одиночный режим: клик по холсту ставит одно место ${sizeNote}`;
    } else if (ed.deskTool.preview?.awaitConfirm) {
      note.textContent = `Превью готово: клик по холсту подтвердит вставку, Esc — отменит ${sizeNote}`;
    } else {
      note.textContent = `Режим блока: выберите ориентацию, drag задает направление, затем клик для подтверждения ${sizeNote}`;
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
  const target = getFitTargetRect();
  const ww = Math.max(1, wrap.clientWidth);
  const wh = Math.max(1, wrap.clientHeight - 26); // minus statusbar

  const pad = Math.max(8, Math.min(220, Math.max(target.w, target.h) * 0.08));
  const tx = target.x - pad;
  const ty = target.y - pad;
  const tw = Math.max(1, target.w + pad * 2);
  const th = Math.max(1, target.h + pad * 2);

  const viewportRatio = ww / wh;
  const targetRatio = tw / th;
  let viewW = tw;
  let viewH = th;
  if (targetRatio > viewportRatio) {
    viewH = tw / viewportRatio;
  } else {
    viewW = th * viewportRatio;
  }

  const cx = tx + tw / 2;
  const cy = ty + th / 2;
  setVb(cx - viewW / 2, cy - viewH / 2, viewW, viewH);
}

function zoomBy(factor, cx, cy) {
  const vb = ed.vb;
  if (cx === undefined) { cx = vb.x + vb.w / 2; cy = vb.y + vb.h / 2; }
  const nw = vb.w * factor, nh = vb.h * factor;
  // Clamp: 5× zoom in, 10× zoom out relative to content
  const ref = getFitTargetRect();
  const origW = Math.max(1, Number(ref?.w || 1000));
  const origH = Math.max(1, Number(ref?.h || 1000));
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
    (doc.doors?.length || 0) +
    (doc.desks?.length || 0)
  );
}

function ensureLayoutArrays(doc) {
  if (!doc || typeof doc !== 'object') return doc;
  doc.building_id = normalizeEntityId(doc.building_id, null);
  doc.storey_id = normalizeEntityId(doc.storey_id, null);
  doc.zone_id = normalizeEntityId(doc.zone_id, null);
  if (!Array.isArray(doc.walls)) doc.walls = [];
  if (!Array.isArray(doc.boundaries)) doc.boundaries = [];
  if (!Array.isArray(doc.partitions)) doc.partitions = [];
  if (!Array.isArray(doc.doors)) doc.doors = [];
  if (!Array.isArray(doc.desks)) doc.desks = [];
  doc.components = normalizeLayoutComponents(doc.components);
  const componentIds = new Set(doc.components.map((component) => component.id));
  const findComponent = (id) => doc.components.find((component) => component.id === id);
  doc.walls = doc.walls.map(el => ({ ...el, locked: !!el?.locked }));
  doc.boundaries = doc.boundaries.map(el => ({ ...el, locked: !!el?.locked }));
  doc.partitions = doc.partitions.map(el => ({ ...el, locked: !!el?.locked }));
  doc.doors = doc.doors.map(el => ({ ...el, locked: !!el?.locked }));
  doc.desks = doc.desks.map((d) => {
    const src = d && typeof d === 'object' ? d : {};
    const id = normalizeEntityId(src.id, uid());
    const rawComponentId = safeComponentId(src.component_id || src.symbol_id);
    const componentId = rawComponentId && componentIds.has(rawComponentId) ? rawComponentId : 'desk-short';
    const component = findComponent(componentId);
    const assetType = src.asset_type
      ? normalizeAssetType(src.asset_type, componentId)
      : (src.component_id ? (component?.asset_type || 'asset') : 'workplace');
    return {
      ...src,
      id,
      inventory_number: normalizeEntityId(src.inventory_number, null),
      workplace_id: assetType === 'workplace' ? normalizeEntityId(src.workplace_id, id) : normalizeEntityId(src.workplace_id, null),
      building_id: normalizeEntityId(src.building_id, doc.building_id),
      storey_id: normalizeEntityId(src.storey_id, doc.storey_id),
      zone_id: normalizeEntityId(src.zone_id, doc.zone_id),
      component_id: componentId,
      symbol_id: componentId,
      asset_type: assetType,
      bookable: assetType === 'workplace' ? src.bookable !== false : false,
      locked: !!src.locked,
    };
  });
  return doc;
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

function defaultZoneLabelSize() {
  const base = Number(ld?.vb?.[2] || 0) * 0.012;
  const fallback = Number.isFinite(base) && base > 0 ? base : DEFAULT_ZONE_LABEL_SIZE;
  return Math.max(12, Math.min(72, fallback));
}

function zoneLabelSize(el) {
  const n = Number(el?.label_size);
  if (Number.isFinite(n) && n > 0) return Math.max(8, Math.min(120, n));
  return defaultZoneLabelSize();
}

function normalizeLabelPos(value) {
  const v = String(value || '').trim().toLowerCase();
  return ['center', 'top', 'bottom', 'left', 'right'].includes(v) ? v : 'center';
}

function labelOrientationFromAngle(value) {
  const a = normalizeDeskRotation(value);
  if (Math.abs(a) <= 0.5) return 'horizontal';
  if (Math.abs(Math.abs(a) - 90) <= 0.5) return 'vertical';
  return 'angle';
}

function labelAngleFromInputs(orientation, angleValue) {
  const orient = String(orientation || '').trim().toLowerCase();
  if (orient === 'vertical') return -90;
  if (orient === 'horizontal') return 0;
  return normalizeDeskRotation(angleValue);
}

function pointsBounds(pts) {
  if (!Array.isArray(pts) || pts.length === 0) return null;
  let minX = Number.POSITIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;
  for (const p of pts) {
    const x = Number(p?.[0]);
    const y = Number(p?.[1]);
    if (!Number.isFinite(x) || !Number.isFinite(y)) continue;
    minX = Math.min(minX, x);
    minY = Math.min(minY, y);
    maxX = Math.max(maxX, x);
    maxY = Math.max(maxY, y);
  }
  if (![minX, minY, maxX, maxY].every(Number.isFinite)) return null;
  return {
    minX,
    minY,
    maxX,
    maxY,
    w: Math.max(1, maxX - minX),
    h: Math.max(1, maxY - minY),
    cx: (minX + maxX) / 2,
    cy: (minY + maxY) / 2,
  };
}

function zoneLabelAnchorPoint(el, fontSize) {
  const bounds = pointsBounds(el?.pts);
  if (!bounds) return centroidOfPoints(el?.pts || []);
  const pos = normalizeLabelPos(el?.label_pos);
  const margin = Math.max(4, fontSize * 0.65, Math.min(bounds.w, bounds.h) * 0.08);
  if (pos === 'top') return { x: bounds.cx, y: bounds.minY + margin };
  if (pos === 'bottom') return { x: bounds.cx, y: bounds.maxY - margin };
  if (pos === 'left') return { x: bounds.minX + margin, y: bounds.cy };
  if (pos === 'right') return { x: bounds.maxX - margin, y: bounds.cy };
  return { x: bounds.cx, y: bounds.cy };
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

function _expandBoundsByPoint(bounds, x, y) {
  if (!Number.isFinite(x) || !Number.isFinite(y)) return;
  bounds.minX = Math.min(bounds.minX, x);
  bounds.minY = Math.min(bounds.minY, y);
  bounds.maxX = Math.max(bounds.maxX, x);
  bounds.maxY = Math.max(bounds.maxY, y);
}

function _hasFiniteBounds(bounds) {
  return Number.isFinite(bounds.minX) &&
    Number.isFinite(bounds.minY) &&
    Number.isFinite(bounds.maxX) &&
    Number.isFinite(bounds.maxY);
}

function getGeometryBounds() {
  if (!ld) return null;
  const bounds = {
    minX: Number.POSITIVE_INFINITY,
    minY: Number.POSITIVE_INFINITY,
    maxX: Number.NEGATIVE_INFINITY,
    maxY: Number.NEGATIVE_INFINITY,
  };

  const scanStruct = (arr) => {
    for (const el of (arr || [])) {
      for (const p of (el?.pts || [])) {
        _expandBoundsByPoint(bounds, Number(p?.[0]), Number(p?.[1]));
      }
    }
  };

  scanStruct(ld.walls);
  scanStruct(ld.boundaries);
  scanStruct(ld.partitions);
  scanStruct(ld.doors);

  for (const d of (ld.desks || [])) {
    const x = Number(d?.x);
    const y = Number(d?.y);
    const w = Number(d?.w);
    const h = Number(d?.h);
    if (!Number.isFinite(x) || !Number.isFinite(y)) continue;
    const dw = Number.isFinite(w) ? Math.max(1, w) : 1;
    const dh = Number.isFinite(h) ? Math.max(1, h) : 1;
    _expandBoundsByPoint(bounds, x, y);
    _expandBoundsByPoint(bounds, x + dw, y + dh);
  }

  if (!_hasFiniteBounds(bounds)) return null;
  return {
    x: bounds.minX,
    y: bounds.minY,
    w: Math.max(1, bounds.maxX - bounds.minX),
    h: Math.max(1, bounds.maxY - bounds.minY),
  };
}

function getFitTargetRect() {
  const geom = getGeometryBounds();
  if (geom) return geom;
  if (ld?.bg_url) return getBackgroundRect();
  return getCanvasRect();
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
  if (!opts.keepMulti && !opts.keepDeskMulti) ed.multiDeskIds = [];
  if (!opts.keepMulti && !opts.keepStructMulti) ed.multiStructKeys = [];
}

function hasMultiDeskSelection() {
  return Array.isArray(ed.multiDeskIds) && ed.multiDeskIds.length > 0;
}

function hasMultiStructSelection() {
  return Array.isArray(ed.multiStructKeys) && ed.multiStructKeys.length > 0;
}

function isStructType(type) {
  return STRUCT_TYPES.includes(type);
}

function structSelKey(type, id) {
  if (!isStructType(type) || !id) return null;
  return `${type}:${id}`;
}

function parseStructSelKey(key) {
  const raw = String(key || '');
  const sep = raw.indexOf(':');
  if (sep <= 0) return null;
  const type = raw.slice(0, sep);
  const id = raw.slice(sep + 1);
  if (!isStructType(type) || !id) return null;
  return { type, id };
}

function isDeskSelected(deskId) {
  if (!deskId) return false;
  if (ed.selType === 'desk' && ed.selId === deskId) return true;
  return (ed.multiDeskIds || []).includes(deskId);
}

function isStructSelected(type, id) {
  if (!isStructType(type) || !id) return false;
  if (ed.selType === type && ed.selId === id) return true;
  const key = structSelKey(type, id);
  return key ? (ed.multiStructKeys || []).includes(key) : false;
}

function setCombinedMultiSelection(deskIds, structKeys, append = false) {
  const deskSet = append ? new Set(ed.multiDeskIds || []) : new Set();
  for (const id of (deskIds || [])) {
    if (id) deskSet.add(id);
  }
  const structSet = append ? new Set(ed.multiStructKeys || []) : new Set();
  for (const raw of (structKeys || [])) {
    const parsed = parseStructSelKey(raw);
    if (!parsed) continue;
    structSet.add(structSelKey(parsed.type, parsed.id));
  }
  ed.multiDeskIds = Array.from(deskSet);
  ed.multiStructKeys = Array.from(structSet);
  ed.selType = null;
  ed.selId = null;
  renderStructure();
  renderDesks();
  renderSelection();
  renderObjectList();
  showPropsFor(null, null);
}

function setMultiDeskSelection(ids, append = false, opts = {}) {
  const { keepStruct = false } = opts;
  const current = append ? new Set(ed.multiDeskIds || []) : new Set();
  for (const id of (ids || [])) {
    if (id) current.add(id);
  }
  ed.multiDeskIds = Array.from(current);
  if (!keepStruct) ed.multiStructKeys = [];
  ed.selType = null;
  ed.selId = null;
  renderStructure();
  renderDesks();
  renderSelection();
  renderObjectList();
  showPropsFor(null, null);
}

function setMultiStructSelection(keys, append = false, opts = {}) {
  const { keepDesk = false } = opts;
  const current = append ? new Set(ed.multiStructKeys || []) : new Set();
  for (const raw of (keys || [])) {
    const parsed = parseStructSelKey(raw);
    if (!parsed) continue;
    current.add(structSelKey(parsed.type, parsed.id));
  }
  ed.multiStructKeys = Array.from(current);
  ed.selType = null;
  ed.selId = null;
  if (!keepDesk) ed.multiDeskIds = [];
  renderStructure();
  renderDesks();
  renderSelection();
  renderObjectList();
  showPropsFor(null, null);
}

function toggleDeskMultiSelection(deskId, opts = {}) {
  const { keepStruct = true } = opts;
  if (!deskId) return;
  const next = new Set(ed.multiDeskIds || []);
  if (next.has(deskId)) next.delete(deskId);
  else next.add(deskId);
  setMultiDeskSelection(Array.from(next), false, { keepStruct });
}

function toggleStructMultiSelection(type, id, opts = {}) {
  const { keepDesk = true } = opts;
  const key = structSelKey(type, id);
  if (!key) return;
  const next = new Set(ed.multiStructKeys || []);
  if (next.has(key)) next.delete(key);
  else next.add(key);
  setMultiStructSelection(Array.from(next), false, { keepDesk });
}

function getStructByTypeId(type, id) {
  const arr = structArrayByType(type);
  if (!Array.isArray(arr)) return null;
  return arr.find((x) => x.id === id) || null;
}

function isDeskLocked(desk) {
  return !!desk?.locked;
}

function isStructLocked(el) {
  return !!el?.locked;
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

function structSelectionBounds(keys) {
  if (!Array.isArray(keys) || !keys.length) return null;
  let x1 = Infinity;
  let y1 = Infinity;
  let x2 = -Infinity;
  let y2 = -Infinity;
  for (const raw of keys) {
    const parsed = parseStructSelKey(raw);
    if (!parsed) continue;
    const el = getStructByTypeId(parsed.type, parsed.id);
    if (!el || !Array.isArray(el.pts)) continue;
    for (const p of el.pts) {
      const px = Number(p?.[0] || 0);
      const py = Number(p?.[1] || 0);
      x1 = Math.min(x1, px);
      y1 = Math.min(y1, py);
      x2 = Math.max(x2, px);
      y2 = Math.max(y2, py);
    }
  }
  if (!Number.isFinite(x1) || !Number.isFinite(y1) || !Number.isFinite(x2) || !Number.isFinite(y2)) {
    return null;
  }
  return { x: x1, y: y1, w: Math.max(1, x2 - x1), h: Math.max(1, y2 - y1) };
}

function structIntersectsRect(el, x1, y1, x2, y2) {
  let sx1 = Infinity;
  let sy1 = Infinity;
  let sx2 = -Infinity;
  let sy2 = -Infinity;
  for (const p of (el?.pts || [])) {
    const px = Number(p?.[0] || 0);
    const py = Number(p?.[1] || 0);
    sx1 = Math.min(sx1, px);
    sy1 = Math.min(sy1, py);
    sx2 = Math.max(sx2, px);
    sy2 = Math.max(sy2, py);
  }
  if (!Number.isFinite(sx1) || !Number.isFinite(sy1) || !Number.isFinite(sx2) || !Number.isFinite(sy2)) {
    return false;
  }
  return !(sx1 > x2 || sx2 < x1 || sy1 > y2 || sy2 < y1);
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
  scanStruct(ld.doors, 'door');
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
  ld.doors = (ld.doors || []).map(el => ({ ...el, pts: mapPts(el.pts) }));
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
  renderImportPreview();
  renderStructure();
  renderDesks();
  renderSelection();
  renderObjectList();
  syncComponentPalette();
  syncComponentPlaceControls();
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
  base.setAttribute('fill', '#eef2f6');
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
  img.setAttribute('opacity', '0.92');
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

  const desks = (ld?.desks || []).filter((d) => isWorkplaceObject(d));
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
  const layers = { wall: _layer('wall'), boundary: _layer('boundary'), partition: _layer('partition'), door: _layer('door') };
  Object.values(layers).forEach(l => { if (l) l.innerHTML = ''; });
  if (!ld) return;
  const strokeScaleVb = Number(ld?.vb?.[2]) || Number(ed.vb.w) || 1000;

  function drawElements(arr, type) {
    const layer = layers[type];
    if (!layer) return;
    if (!isInventoryVisible(type)) return;
    const defaultColor = STRUCT_COLORS[type];

    for (const el of arr) {
      if (!el.pts || el.pts.length < 2) continue;
      const isPrimarySel = ed.selType === type && ed.selId === el.id;
      const isSel = isStructSelected(type, el.id);
      const isLocked = isStructLocked(el);
      const col = type === 'boundary'
        ? normalizeHexColor(el.color, defaultColor)
        : defaultColor;
      const g = document.createElementNS(NS, 'g');
      g.dataset.id = el.id;
      g.dataset.type = type;

      const tagName = el.closed ? 'polygon' : 'polyline';
      const shape = _makePolyEl(tagName, el.pts, el.closed);
      const hitShape = _makePolyEl(tagName, el.pts, el.closed);
      const strokeW = layoutStrokeWidth(type, el.thick, strokeScaleVb);
      const hitStroke = Math.max(worldUnitsForScreenPx(OBJECT_HIT_PX), strokeW + worldUnitsForScreenPx(6));

      hitShape.setAttribute('fill', el.closed ? 'rgba(0,0,0,0)' : 'none');
      hitShape.setAttribute('stroke', 'rgba(0,0,0,0)');
      hitShape.setAttribute('stroke-width', String(hitStroke));
      hitShape.setAttribute('stroke-linecap', 'butt');
      hitShape.setAttribute('stroke-linejoin', 'round');
      hitShape.setAttribute('pointer-events', el.closed ? 'all' : 'stroke');
      if (ed.mode === 'select') {
        hitShape.setAttribute('cursor', isLocked ? 'not-allowed' : 'pointer');
      } else {
        hitShape.setAttribute('cursor', 'default');
      }
      hitShape.addEventListener('pointerdown', ev => onStructPointerDown(ev, type, el.id));
      g.appendChild(hitShape);

      if (type === 'boundary') {
        shape.setAttribute('fill', el.closed === false ? 'none' : col);
        shape.setAttribute('fill-opacity', '0.12');
        shape.setAttribute('stroke', col);
      } else {
        shape.setAttribute('fill', 'none');
        shape.setAttribute('stroke', col);
      }
      shape.setAttribute('stroke-width', String(strokeW));
      shape.setAttribute('stroke-linecap', 'butt');
      shape.setAttribute('stroke-linejoin', 'round');

      if (isSel) {
        shape.setAttribute('stroke', '#3b82f6');
        shape.setAttribute('stroke-dasharray', '6 3');
      }

      shape.setAttribute('pointer-events', 'none');
      g.appendChild(shape);

      if (type === 'boundary' && el.label) {
        const fontSize = zoneLabelSize(el);
        const c = zoneLabelAnchorPoint(el, fontSize);
        const angle = normalizeDeskRotation(el.label_angle || 0);
        const txt = document.createElementNS(NS, 'text');
        txt.setAttribute('x', String(c.x));
        txt.setAttribute('y', String(c.y));
        txt.setAttribute('text-anchor', 'middle');
        txt.setAttribute('dominant-baseline', 'middle');
        txt.setAttribute('font-size', String(fontSize));
        txt.setAttribute('font-family', 'system-ui, sans-serif');
        txt.setAttribute('font-weight', '700');
        txt.setAttribute('fill', isSel ? '#1e40af' : col);
        txt.setAttribute('stroke', '#ffffff');
        txt.setAttribute('stroke-width', String(Math.max(0.9, fontSize * 0.08)));
        txt.setAttribute('paint-order', 'stroke');
        txt.setAttribute('pointer-events', 'none');
        if (Math.abs(angle) > 1e-6) {
          txt.setAttribute('transform', `rotate(${angle} ${c.x} ${c.y})`);
        }
        txt.textContent = el.label;
        g.appendChild(txt);
      }

      // Vertex dots when selected
      if (isPrimarySel) {
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
  drawElements(ld.doors || [], 'door');
}

function safeSvgClassList(value) {
  return String(value || '')
    .split(/\s+/)
    .map((part) => part.replace(/[^A-Za-z0-9_-]+/g, '-').replace(/^-+|-+$/g, ''))
    .filter(Boolean)
    .slice(0, 10)
    .join(' ');
}

function copySafeSvgNodeForCanvas(node) {
  const tag = String(node?.localName || '').toLowerCase();
  if (!SVG_RENDER_TAGS.has(tag)) return null;
  const out = document.createElementNS(NS, tag);
  Array.from(node.attributes || []).forEach((attr) => {
    const name = String(attr.localName || attr.name || '').toLowerCase();
    const value = String(attr.value || '').trim();
    const lower = value.toLowerCase();
    if (!SVG_RENDER_ATTRS.has(name)) return;
    if (name.startsWith('on') || lower.includes('javascript:') || lower.includes('url(')) return;
    if (/[\r\n\t]/.test(value)) return;
    if ((name === 'href' || name === 'xlink:href') && !/^#[A-Za-z_][A-Za-z0-9_.:-]{0,119}$/.test(value)) return;
    out.setAttribute(name === 'xlink:href' ? 'href' : name, name === 'class' ? safeSvgClassList(value) : value);
  });
  if (tag === 'text') out.textContent = String(node.textContent || '').slice(0, 300);
  Array.from(node.children || []).forEach((child) => {
    const cleanChild = copySafeSvgNodeForCanvas(child);
    if (cleanChild) out.appendChild(cleanChild);
  });
  return out;
}

function appendCustomComponentVisual(g, component, desk) {
  if (!component?.svg_markup || !isSafeSvgMarkup(component.svg_markup)) return false;
  const parser = new DOMParser();
  const parsed = parser.parseFromString(`<svg xmlns="${NS}">${component.svg_markup}</svg>`, 'image/svg+xml');
  if (parsed.querySelector('parsererror')) return false;
  const vb = Array.isArray(component.view_box) && component.view_box.length === 4 ? component.view_box : [0, 0, 100, 60];
  const [vx, vy, vw, vh] = vb.map((n) => Number(n));
  if (![vx, vy, vw, vh].every(Number.isFinite) || vw <= 0 || vh <= 0) return false;
  const x = Number(desk.x || 0);
  const y = Number(desk.y || 0);
  const w = Math.max(1, Number(desk.w || 1));
  const h = Math.max(1, Number(desk.h || 1));
  const group = document.createElementNS(NS, 'g');
  group.setAttribute('transform', `translate(${x} ${y}) scale(${w / vw} ${h / vh}) translate(${-vx} ${-vy})`);
  Array.from(parsed.documentElement.children || []).forEach((child) => {
    const clean = copySafeSvgNodeForCanvas(child);
    if (clean) group.appendChild(clean);
  });
  if (!group.childNodes.length) return false;
  g.appendChild(group);
  return true;
}

function appendDeskAssetVisual(g, desk, fill, stroke, isSel, cursor, swBase) {
  const component = componentForId(desk.component_id || desk.symbol_id, 'desk-short');
  const componentId = component?.id || 'desk-short';
  const outline = isSel ? '#3b82f6' : stroke;
  const strokeWidth = String(isSel ? swBase * 2 : swBase);
  const dash = isSel ? '5 2' : null;
  const x = Number(desk.x || 0);
  const y = Number(desk.y || 0);
  const w = Math.max(1, Number(desk.w || 1));
  const h = Math.max(1, Number(desk.h || 1));
  const cx = x + w / 2;

  const setCommon = (node, opts = {}) => {
    node.setAttribute('stroke', opts.stroke || outline);
    node.setAttribute('stroke-width', opts.strokeWidth || strokeWidth);
    node.setAttribute('cursor', cursor);
    if (dash) node.setAttribute('stroke-dasharray', dash);
    return node;
  };

  const hit = document.createElementNS(NS, 'rect');
  hit.setAttribute('x', x);
  hit.setAttribute('y', y);
  hit.setAttribute('width', w);
  hit.setAttribute('height', h);
  hit.setAttribute('fill', 'transparent');
  hit.setAttribute('stroke', 'none');
  hit.setAttribute('cursor', cursor);
  g.appendChild(hit);

  if (component?.source === 'custom' && appendCustomComponentVisual(g, component, desk)) return;

  const drawDesk = (dx, dy, dw, dh, long = false) => {
    const rect = setCommon(document.createElementNS(NS, 'rect'));
    rect.setAttribute('x', dx);
    rect.setAttribute('y', dy);
    rect.setAttribute('width', dw);
    rect.setAttribute('height', dh);
    rect.setAttribute('rx', String(Math.max(1, dh * 0.08)));
    rect.setAttribute('fill', fill);
    g.appendChild(rect);
    if (long) {
      const divider = setCommon(document.createElementNS(NS, 'line'), { strokeWidth: String(Math.max(0.7, swBase)) });
      divider.setAttribute('x1', dx + dw / 2);
      divider.setAttribute('x2', dx + dw / 2);
      divider.setAttribute('y1', dy + dh * 0.15);
      divider.setAttribute('y2', dy + dh * 0.85);
      divider.setAttribute('stroke-opacity', '0.65');
      g.appendChild(divider);
    }
  };

  const drawChair = (dx, dy, dw, dh) => {
    const backH = Math.max(2, dh * 0.28);
    const back = setCommon(document.createElementNS(NS, 'rect'));
    back.setAttribute('x', dx + dw * 0.12);
    back.setAttribute('y', dy + dh * 0.05);
    back.setAttribute('width', dw * 0.76);
    back.setAttribute('height', backH);
    back.setAttribute('rx', String(Math.max(1, backH * 0.3)));
    back.setAttribute('fill', fill);
    g.appendChild(back);

    const seat = setCommon(document.createElementNS(NS, 'rect'));
    seat.setAttribute('x', dx + dw * 0.1);
    seat.setAttribute('y', dy + backH);
    seat.setAttribute('width', dw * 0.8);
    seat.setAttribute('height', Math.max(1, (dh - backH) * 0.78));
    seat.setAttribute('rx', String(Math.max(1, Math.min(dw, dh) * 0.14)));
    seat.setAttribute('fill', fill);
    g.appendChild(seat);
  };

  const drawMeeting = (dx, dy, dw, dh) => {
    const table = setCommon(document.createElementNS(NS, 'rect'));
    table.setAttribute('x', dx + dw * 0.08);
    table.setAttribute('y', dy + dh * 0.16);
    table.setAttribute('width', dw * 0.84);
    table.setAttribute('height', dh * 0.68);
    table.setAttribute('rx', String(Math.max(2, Math.min(dw, dh) * 0.2)));
    table.setAttribute('fill', fill);
    g.appendChild(table);
    const chairR = Math.max(1.5, Math.min(dw, dh) * 0.06);
    [[dx + dw * 0.2, dy + dh * 0.1], [dx + dw * 0.5, dy + dh * 0.08], [dx + dw * 0.8, dy + dh * 0.1], [dx + dw * 0.2, dy + dh * 0.9], [dx + dw * 0.5, dy + dh * 0.92], [dx + dw * 0.8, dy + dh * 0.9]].forEach(([px, py]) => {
      const c = setCommon(document.createElementNS(NS, 'circle'), { strokeWidth: String(Math.max(0.6, swBase)) });
      c.setAttribute('cx', px);
      c.setAttribute('cy', py);
      c.setAttribute('r', chairR);
      c.setAttribute('fill', '#fff');
      g.appendChild(c);
    });
  };

  if (componentId === 'workplace-desk-chair') {
    drawDesk(x, y, w, h * 0.56, false);
    drawChair(x + w * 0.32, y + h * 0.62, w * 0.36, h * 0.34);
    return;
  }
  if (componentId === 'chair' || componentId === 'conference-chair') {
    drawChair(x, y, w, h);
    return;
  }
  if (componentId === 'meeting-table') {
    drawMeeting(x, y, w, h);
    return;
  }
  if (componentId === 'conference-set') {
    drawMeeting(x + w * 0.18, y + h * 0.22, w * 0.64, h * 0.56);
    drawChair(x + w * 0.42, y, w * 0.16, h * 0.24);
    drawChair(x + w * 0.42, y + h * 0.76, w * 0.16, h * 0.24);
    drawChair(x, y + h * 0.38, w * 0.18, h * 0.24);
    drawChair(x + w * 0.82, y + h * 0.38, w * 0.18, h * 0.24);
    return;
  }

  drawDesk(x, y, w, h, componentId === 'desk-long');
}

function renderDesks() {
  const layer = _layer('desk');
  if (!layer || !ld) return;
  layer.innerHTML = '';

  const swBase = Math.max(0.5, ed.vb.w * 0.0012);

  for (const desk of ld.desks) {
    if (!isInventoryVisible(inventoryTypeForDesk(desk))) continue;
    const isSel = isDeskSelected(desk.id);
    const isLocked = isDeskLocked(desk);
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
    g.dataset.workplaceId = isWorkplaceObject(desk) ? (desk.workplace_id || desk.id) : '';
    g.dataset.building = desk.building_id || ld.building_id || '';
    g.dataset.storey = desk.storey_id || ld.storey_id || '';
    g.dataset.zone = desk.zone_id || ld.zone_id || '';
    g.dataset.componentId = normalizeLayoutSymbolId(desk.component_id || desk.symbol_id);
    g.dataset.symbol = g.dataset.componentId;
    g.dataset.assetType = normalizeAssetType(desk.asset_type, g.dataset.componentId);
    g.dataset.inventoryNumber = desk.inventory_number || '';
    const cx = desk.x + desk.w / 2, cy = desk.y + desk.h / 2;
    const cursor = ed.mode === 'select'
      ? (isLocked ? 'not-allowed' : 'pointer')
      : 'crosshair';

    if (desk.r) {
      g.setAttribute('transform', `rotate(${desk.r} ${cx} ${cy})`);
    }

    appendDeskAssetVisual(g, desk, fill, stroke, isSel, cursor, swBase);

    if (isWorkplaceObject(desk)) {
      const txt = document.createElementNS(NS, 'text');
      txt.setAttribute('x', String(cx)); txt.setAttribute('y', String(cy));
      txt.setAttribute('text-anchor', 'middle');
      txt.setAttribute('dominant-baseline', 'middle');
      txt.setAttribute('font-size', String(Math.max(4, Math.min(desk.h * 0.22, desk.w * 0.14))));
      txt.setAttribute('fill', stroke);
      txt.setAttribute('pointer-events', 'none');
      txt.setAttribute('font-family', 'system-ui, sans-serif');
      txt.setAttribute('font-weight', '600');
      txt.textContent = desk.label;
      g.appendChild(txt);
    }

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
    if (desk && isInventoryVisible(inventoryTypeForDesk(desk))) {
      const cx = desk.x + desk.w / 2;
      const cy = desk.y + desk.h / 2;
      const ang = _degToRad(desk.r || 0);
      const ux = Math.sin(ang);
      const uy = -Math.cos(ang);

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

      if (!isDeskLocked(desk)) {
        handles.forEach(([hx, hy], i) => {
          const circle = document.createElementNS(NS, 'circle');
          circle.setAttribute('cx', hx); circle.setAttribute('cy', hy);
          circle.setAttribute('r', String(r));
          circle.setAttribute('fill', '#fff'); circle.setAttribute('stroke', '#3b82f6');
          circle.setAttribute('stroke-width', '1.5');
          circle.setAttribute('cursor', cursors[i]);
          circle.setAttribute('pointer-events', 'all');
          circle.addEventListener('pointerdown', ev => onResizeHandleDown(ev, desk, i));
          layer.appendChild(circle);
        });

        const topCx = cx + ux * (desk.h / 2);
        const topCy = cy + uy * (desk.h / 2);
        const armLen = Math.max(r * 2.8, ed.vb.w * 0.028);
        const rotX = topCx + ux * armLen;
        const rotY = topCy + uy * armLen;

        const arm = document.createElementNS(NS, 'line');
        arm.setAttribute('x1', String(topCx));
        arm.setAttribute('y1', String(topCy));
        arm.setAttribute('x2', String(rotX));
        arm.setAttribute('y2', String(rotY));
        arm.setAttribute('stroke', '#3b82f6');
        arm.setAttribute('stroke-width', String(Math.max(1.2, ed.vb.w * 0.0014)));
        arm.setAttribute('pointer-events', 'none');
        layer.appendChild(arm);

        const rotateHandle = document.createElementNS(NS, 'circle');
        rotateHandle.setAttribute('cx', String(rotX));
        rotateHandle.setAttribute('cy', String(rotY));
        rotateHandle.setAttribute('r', String(Math.max(r * 0.9, ed.vb.w * 0.0044)));
        rotateHandle.setAttribute('fill', '#eff6ff');
        rotateHandle.setAttribute('stroke', '#1d4ed8');
        rotateHandle.setAttribute('stroke-width', '1.6');
        rotateHandle.setAttribute('cursor', 'grab');
        rotateHandle.setAttribute('pointer-events', 'all');
        rotateHandle.addEventListener('pointerdown', ev => onRotateHandleDown(ev, desk));
        layer.appendChild(rotateHandle);
      }
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

      const movableIds = (ed.multiDeskIds || []).filter((id) => {
        const d = (ld.desks || []).find((x) => x.id === id);
        return !!d && !isDeskLocked(d);
      });
      if (movableIds.length) {
        const boxCx = box.x + box.w / 2;
        const topCy = box.y;
        const armLen = Math.max(r * 2.8, ed.vb.w * 0.03);
        const rotY = topCy - armLen;

        const arm = document.createElementNS(NS, 'line');
        arm.setAttribute('x1', String(boxCx));
        arm.setAttribute('y1', String(topCy));
        arm.setAttribute('x2', String(boxCx));
        arm.setAttribute('y2', String(rotY));
        arm.setAttribute('stroke', '#1d4ed8');
        arm.setAttribute('stroke-width', String(Math.max(1.2, ed.vb.w * 0.0014)));
        arm.setAttribute('pointer-events', 'none');
        layer.appendChild(arm);

        const rotateHandle = document.createElementNS(NS, 'circle');
        rotateHandle.setAttribute('cx', String(boxCx));
        rotateHandle.setAttribute('cy', String(rotY));
        rotateHandle.setAttribute('r', String(Math.max(r * 0.95, ed.vb.w * 0.0046)));
        rotateHandle.setAttribute('fill', '#eff6ff');
        rotateHandle.setAttribute('stroke', '#1d4ed8');
        rotateHandle.setAttribute('stroke-width', '1.7');
        rotateHandle.setAttribute('cursor', 'grab');
        rotateHandle.setAttribute('pointer-events', 'all');
        rotateHandle.addEventListener('pointerdown', (ev) => onMultiDeskRotateHandleDown(ev, movableIds));
        layer.appendChild(rotateHandle);
      }
    }
  }

  if (hasMultiStructSelection()) {
    const box = structSelectionBounds(ed.multiStructKeys);
    if (box) {
      const rect = document.createElementNS(NS, 'rect');
      rect.setAttribute('x', String(box.x));
      rect.setAttribute('y', String(box.y));
      rect.setAttribute('width', String(box.w));
      rect.setAttribute('height', String(box.h));
      rect.setAttribute('fill', 'none');
      rect.setAttribute('stroke', '#475569');
      rect.setAttribute('stroke-width', String(Math.max(1.1, ed.vb.w * 0.0013)));
      rect.setAttribute('stroke-dasharray', '7 4');
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
    pl.setAttribute('stroke-linecap', 'butt');
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
  bg.setAttribute('fill', '#eef2f6');
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
  drawMM(ld.walls,      STRUCT_COLORS.wall, null);
  drawMM(ld.partitions, STRUCT_COLORS.partition, null);
  drawMM(ld.doors || [], STRUCT_COLORS.door, null);

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
    if (ed.shiftDown && isDrawMode(ed.mode)) flags.push(`ANGLE ${DRAW_ANGLE_STEP_DEG}°`);
    else if (ed.shiftFine) flags.push('FINE');
    precEl.textContent = flags.join(' · ');
  }
  if (zoomEl && ld) {
    const pct = Math.round(ld.vb[2] / ed.vb.w * 100);
    zoomEl.textContent = pct + '%';
  }
}

function modeLabel(m) {
  return { select:'Выбор', pan:'Рука', wall:'Стена', boundary:'Граница', partition:'Перегородка', door:'Дверь', desk:'Место', component:'Компонент' }[m] || m;
}

/* ── Object list ────────────────────────────────────────────────────────────── */
function renderObjectList() {
  const list = $el('ed-obj-list');
  if (!list) return;
  syncInventoryFilters();
  if (!ld) { list.innerHTML = '<p style="color:#475569;font-size:12px;padding:8px 10px">Загрузите этаж</p>'; return; }

  const q = ($el('ed-obj-search')?.value || '').toLowerCase();

  function makeSection(title, items, type, colorFn) {
    if (!isInventoryVisible(type) || !items.length) return '';
    const filtered = items.filter(it => {
      const haystack = `${it.label || ''} ${it.inventory_number || ''} ${it.pts?.length?.toString() || ''}`.toLowerCase();
      return !q || haystack.includes(q);
    });
    if (!filtered.length) return '';
    let html = `<div class="ed-obj-section-header">${title} (${filtered.length})</div>`;
    for (const it of filtered) {
      let active = false;
      if (ASSET_TYPES.has(type)) active = isDeskSelected(it.id);
      else active = isStructSelected(type, it.id);
      const lbl = it.label || `${title.slice(0,-1)} (${it.pts?.length || '?'} pts)`;
      const inventory = ASSET_TYPES.has(type) && it.inventory_number ? ` · ${it.inventory_number}` : '';
      const lblEsc = escapeHtml(lbl);
      const inventoryEsc = escapeHtml(inventory);
      const itemIdEsc = escapeHtml(it.id);
      const itemTypeEsc = escapeHtml(type);
      const color = colorFn(it);
      const lockBadge = it.locked ? '<span class="ed-obj-lock" title="Закреплён">L</span>' : '';
      html += `<div class="ed-obj-item${active?' active':''}" data-id="${itemIdEsc}" data-type="${itemTypeEsc}">
        <span class="ed-obj-dot" style="background:${color}"></span>
        <span class="ed-obj-label" title="${lblEsc}${inventoryEsc}">${lblEsc}${inventoryEsc}</span>
        ${lockBadge}
      </div>`;
    }
    return html;
  }

  const desksByType = (type) => (ld.desks || []).filter((item) => inventoryTypeForDesk(item) === type);
  list.innerHTML =
    makeSection('Рабочие места', desksByType('workplace'), 'workplace', d => d.fixed ? '#d97706' : '#2563eb') +
    makeSection('Столы',         desksByType('desk'),      'desk',      () => '#8b5e34') +
    makeSection('Стулья',        desksByType('chair'),     'chair',     () => '#64748b') +
    makeSection('Переговорные',  desksByType('meeting_table'), 'meeting_table', () => '#0f766e') +
    makeSection('Конф. сеты',    desksByType('conference_set'), 'conference_set', () => '#7c3aed') +
    makeSection('Assets',        desksByType('asset'),     'asset',     () => '#64748b') +
    makeSection('Стены',         ld.walls,      'wall',      () => STRUCT_COLORS.wall) +
    makeSection('Границы',       ld.boundaries, 'boundary',  b => normalizeHexColor(b.color, DEFAULT_ZONE_COLOR)) +
    makeSection('Перегородки',   ld.partitions, 'partition', () => STRUCT_COLORS.partition) +
    makeSection('Двери',         ld.doors || [], 'door',     () => STRUCT_COLORS.door);

  list.querySelectorAll('.ed-obj-item').forEach(item => {
    item.addEventListener('click', (ev) => {
      const type = item.dataset.type;
      const id = item.dataset.id;
      if (ev.shiftKey) {
        if (ASSET_TYPES.has(type)) toggleDeskMultiSelection(id, { keepStruct: true });
        else if (isStructType(type)) toggleStructMultiSelection(type, id, { keepDesk: true });
        return;
      }
      selectObj(ASSET_TYPES.has(type) ? 'desk' : type, id);
    });
  });
}

/* ── Selection ──────────────────────────────────────────────────────────────── */
function selectObj(type, id) {
  ed.multiDeskIds = [];
  ed.multiStructKeys = [];
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
  const deskSingle = $el('ep-single-desk-fields');
  const deskMulti = $el('ep-multi-desk-panel');
  const deskMultiMode = type === null && hasMultiDeskSelection() && !hasMultiStructSelection();

  if (empty)   empty.classList.toggle('ed-hidden', type !== null || deskMultiMode);
  if (deskP)   deskP.classList.toggle('ed-hidden', !(type === 'desk' || deskMultiMode));
  if (structP) structP.classList.toggle('ed-hidden', !['wall','boundary','partition','door'].includes(type));
  if (zoneFields) zoneFields.classList.toggle('ed-hidden', type !== 'boundary');
  if (deskSingle) deskSingle.classList.toggle('ed-hidden', deskMultiMode);
  if (deskMulti) deskMulti.classList.toggle('ed-hidden', !deskMultiMode);

  if (deskMultiMode) {
    syncDeskBatchPanel();
    toggleStructLabelAngleField();
    return;
  }

  if (type === 'desk' && id && ld) {
    const d = ld.desks.find(x => x.id === id);
    if (!d) return;
    _v('ep-label', d.label);
    _v('ep-inventory-number', d.inventory_number || '');
    _v('ep-name',  d.name || '');
    _v('ep-team',  d.team || '');
    _v('ep-dept',  d.dept || '');
    const componentId = normalizeLayoutSymbolId(d.component_id || d.symbol_id);
    syncComponentSelectElement($el('ep-symbol'), componentId);
    _v('ep-symbol', componentId);
    _v('ep-asset-type', normalizeAssetType(d.asset_type, componentId));
    _v('ep-workplace-id', isWorkplaceObject(d) ? (d.workplace_id || d.id) : (d.workplace_id || ''));
    _v('ep-building-id', d.building_id || ld.building_id || '');
    _v('ep-storey-id', d.storey_id || ld.storey_id || '');
    _v('ep-zone-id', d.zone_id || ld.zone_id || '');
    _vc('ep-bookable', isWorkplaceObject(d) && d.bookable !== false);
    _vc('ep-fixed',    !!d.fixed);
    _vc('ep-locked',   !!d.locked);
    _v('ep-assigned',  d.assigned_to || '');
    _v('ep-status',    d.status || 'available');
    _v('ep-x', Math.round(d.x));
    _v('ep-y', Math.round(d.y));
    _v('ep-w', Math.round(d.w));
    _v('ep-h', Math.round(d.h));
    _v('ep-r', Math.round(d.r || 0));
    const standardSizeBtn = $el('ep-standard-size');
    if (standardSizeBtn) standardSizeBtn.disabled = isDeskLocked(d) || !isWorkplaceObject(d);
  }

  if (['wall','boundary','partition','door'].includes(type) && id && ld) {
    const arr = type === 'wall'
      ? ld.walls
      : type === 'boundary'
        ? ld.boundaries
        : type === 'partition'
          ? ld.partitions
          : (ld.doors || []);
    const el = arr.find(x => x.id === id);
    if (!el) return;
    _v('ep-struct-type',   type);
    _v('ep-struct-thick',  el.thick || 4);
    _vc('ep-struct-closed', !!el.closed);
    _vc('ep-struct-locked', !!el.locked);
    _v('ep-struct-label', type === 'boundary' ? (el.label || '') : '');
    _v('ep-struct-label-size', type === 'boundary' ? Math.round(zoneLabelSize(el)) : '');
    _v('ep-struct-color', normalizeHexColor(el.color, DEFAULT_ZONE_COLOR));
    if (type === 'boundary') {
      const labelPos = normalizeLabelPos(el.label_pos);
      const labelAngle = normalizeDeskRotation(el.label_angle || 0);
      _v('ep-struct-label-pos', labelPos);
      _v('ep-struct-label-angle', Math.round(labelAngle));
      _v('ep-struct-label-orient', labelOrientationFromAngle(labelAngle));
    }
    const ptCount = $el('ep-struct-pt-count');
    if (ptCount) ptCount.textContent = el.pts?.length || 0;
  }
  toggleStructLabelAngleField();
}

function _v(id, val) { const el = $el(id); if (el) el.value = val; }
function _vc(id, checked) { const el = $el(id); if (el) el.checked = checked; }

function _numOrNull(id) {
  const raw = String($el(id)?.value ?? '').trim();
  if (raw === '') return null;
  const n = Number(raw);
  return Number.isFinite(n) ? n : null;
}

function parseBatchBool(id) {
  const raw = String($el(id)?.value ?? '').trim().toLowerCase();
  if (raw === 'true') return true;
  if (raw === 'false') return false;
  return null;
}

function selectedDeskIds(opts = {}) {
  const { includePrimary = true } = opts;
  const set = new Set(ed.multiDeskIds || []);
  if (includePrimary && ed.selType === 'desk' && ed.selId) set.add(ed.selId);
  return Array.from(set);
}

function selectedDeskRecords(opts = {}) {
  const { includePrimary = true, skipLocked = false } = opts;
  const ids = new Set(selectedDeskIds({ includePrimary }));
  let desks = (ld?.desks || []).filter((d) => ids.has(d.id));
  if (skipLocked) desks = desks.filter((d) => !isDeskLocked(d));
  return desks;
}

function syncDeskBatchPanel() {
  const countEl = $el('ep-multi-desk-count');
  const applyBtn = $el('ep-batch-apply');
  const standardSizeBtn = $el('ep-batch-standard-size');
  const groupBtn = $el('ep-batch-group-component');
  const selected = selectedDeskRecords({ includePrimary: false, skipLocked: false });
  const locked = selected.filter((d) => isDeskLocked(d)).length;
  const editable = selected.length - locked;
  const editableWorkplaces = selected.filter((d) => !isDeskLocked(d) && isWorkplaceObject(d)).length;
  if (countEl) {
    countEl.textContent = locked > 0
      ? `Выбрано объектов: ${selected.length} (редактируемо: ${editable}, закреплено: ${locked})`
      : `Выбрано объектов: ${selected.length}`;
  }
  if (applyBtn) applyBtn.disabled = editable <= 0;
  if (standardSizeBtn) standardSizeBtn.disabled = editableWorkplaces <= 0;
  if (groupBtn) groupBtn.disabled = editable < 2;
}

function applyDeskBatchProps() {
  if (!ld || !hasMultiDeskSelection()) return;
  const targets = selectedDeskRecords({ includePrimary: false, skipLocked: true });
  const lockedSkipped = selectedDeskRecords({ includePrimary: false, skipLocked: false }).length - targets.length;
  if (!targets.length) {
    edToast('Выбранные объекты закреплены и недоступны для редактирования', 'info');
    return;
  }

  const statusRaw = String($el('ep-batch-status')?.value || '').trim();
  const status = ['available', 'occupied', 'disabled'].includes(statusRaw) ? statusRaw : null;
  const bookable = parseBatchBool('ep-batch-bookable');
  const fixed = parseBatchBool('ep-batch-fixed');
  const locked = parseBatchBool('ep-batch-locked');
  const w = _numOrNull('ep-batch-w');
  const h = _numOrNull('ep-batch-h');
  const r = _numOrNull('ep-batch-r');

  const hasAnyPatch =
    status !== null ||
    bookable !== null ||
    fixed !== null ||
    locked !== null ||
    w !== null ||
    h !== null ||
    r !== null;

  if (!hasAnyPatch) {
    edToast('Укажите хотя бы одно свойство для пакетного применения', 'info');
    return;
  }

  for (const d of targets) {
    if (status !== null) d.status = status;
    if (bookable !== null) d.bookable = bookable;
    if (fixed !== null) d.fixed = fixed;
    if (locked !== null) d.locked = locked;
    if (w !== null) d.w = Math.max(1, w);
    if (h !== null) d.h = Math.max(1, h);
    if (r !== null) d.r = normalizeDeskRotation(r);
  }

  markDirty();
  renderDesks();
  renderSelection();
  renderObjectList();
  syncDeskBatchPanel();

  if (lockedSkipped > 0) {
    edToast(`Обновлено объектов: ${targets.length}. Закреплено и пропущено: ${lockedSkipped}`, 'info');
  } else {
    edToast(`Обновлено объектов: ${targets.length}`, 'success');
  }
}

function resizeWorkplaceToStandardSize(d) {
  if (!d || isDeskLocked(d) || !isWorkplaceObject(d)) return false;
  const size = deskSizeForPreset('normal');
  const currentW = Math.max(1, Number(d.w) || size.w);
  const currentH = Math.max(1, Number(d.h) || size.h);
  const cx = (Number(d.x) || 0) + currentW / 2;
  const cy = (Number(d.y) || 0) + currentH / 2;
  d.w = size.w;
  d.h = size.h;
  d.x = cx - size.w / 2;
  d.y = cy - size.h / 2;
  return true;
}

function applyStandardSizeToSelectedDesk() {
  if (ed.selType !== 'desk' || !ed.selId || !ld) return;
  const d = ld.desks.find((x) => x.id === ed.selId);
  if (!d) return;
  if (isDeskLocked(d)) {
    edToast('Объект закреплён: изменение размера недоступно', 'info');
    return;
  }
  if (!isWorkplaceObject(d)) {
    edToast('Стандартный размер применяется только к объектам типа "Место"', 'info');
    return;
  }
  if (!resizeWorkplaceToStandardSize(d)) return;

  markDirty();
  renderDesks();
  renderSelection();
  renderObjectList();
  showPropsFor('desk', d.id);
  edToast('Размер места приведён к стандартному', 'success');
}

function applyStandardSizeToSelectedDesks() {
  if (!ld || !hasMultiDeskSelection()) return;
  const selected = selectedDeskRecords({ includePrimary: false, skipLocked: false });
  const targets = selected.filter((d) => !isDeskLocked(d) && isWorkplaceObject(d));
  const skipped = selected.length - targets.length;
  if (!targets.length) {
    edToast('Нет редактируемых мест для изменения размера', 'info');
    return;
  }

  for (const d of targets) resizeWorkplaceToStandardSize(d);

  markDirty();
  renderDesks();
  renderSelection();
  renderObjectList();
  syncDeskBatchPanel();

  if (skipped > 0) {
    edToast(`Стандартный размер применён: ${targets.length}. Пропущено: ${skipped}`, 'info');
  } else {
    edToast(`Стандартный размер применён: ${targets.length}`, 'success');
  }
}

function componentMarkupForComposition(component) {
  if (!component) return '';
  if (component.source === 'custom' && component.svg_markup && isSafeSvgMarkup(component.svg_markup)) {
    return component.svg_markup;
  }
  if (typeof builtinComponentMarkup === 'function') {
    const markup = builtinComponentMarkup(component);
    return isSafeSvgMarkup(markup) ? markup : '';
  }
  const vb = Array.isArray(component.view_box) ? component.view_box : [0, 0, component.default_w || 100, component.default_h || 60];
  const w = Math.max(1, Number(vb[2] || component.default_w || 100));
  const h = Math.max(1, Number(vb[3] || component.default_h || 60));
  return `<rect x="0" y="0" width="${svgNum(w)}" height="${svgNum(h)}" rx="2" fill="#dbeafe" stroke="#2563eb" stroke-width="1.5"/>`;
}

function composeSelectedDesksMarkup(desks, bounds) {
  const parts = [];
  for (const desk of desks) {
    const component = componentForId(desk.component_id || desk.symbol_id, 'desk-short');
    const markup = componentMarkupForComposition(component);
    if (!markup) return null;
    const vb = Array.isArray(component.view_box) && component.view_box.length === 4 ? component.view_box : [0, 0, 100, 60];
    const vx = Number(vb[0]) || 0;
    const vy = Number(vb[1]) || 0;
    const vw = Math.max(1, Number(vb[2]) || 100);
    const vh = Math.max(1, Number(vb[3]) || 60);
    const localX = Number(desk.x || 0) - bounds.x;
    const localY = Number(desk.y || 0) - bounds.y;
    const w = Math.max(1, Number(desk.w || 1));
    const h = Math.max(1, Number(desk.h || 1));
    const assetType = normalizeAssetType(desk.asset_type, component.id);
    const transforms = [
      `translate(${svgNum(localX)} ${svgNum(localY)})`,
      Math.abs(Number(desk.r || 0)) > 1e-6 ? `rotate(${svgNum(desk.r)} ${svgNum(w / 2)} ${svgNum(h / 2)})` : '',
      `scale(${svgNum(w / vw)} ${svgNum(h / vh)})`,
      `translate(${svgNum(-vx)} ${svgNum(-vy)})`,
    ].filter(Boolean).join(' ');
    parts.push(`<g class="component-child asset-${escapeHtml(assetType.replace(/_/g, '-'))}" transform="${escapeHtml(transforms)}">\n${markup}\n</g>`);
  }
  return parts.join('\n');
}

async function saveCompositeComponent(payload) {
  const res = await fetch(API + '/components', {
    method: 'POST',
    headers: { ...ah(), 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.detail || res.statusText);
  }
}

async function groupSelectedDesksIntoComponent() {
  if (!ld || !hasMultiDeskSelection()) return;
  const selected = selectedDeskRecords({ includePrimary: false, skipLocked: false });
  const targets = selected.filter((d) => !isDeskLocked(d));
  const lockedSkipped = selected.length - targets.length;
  if (targets.length < 2) {
    edToast('Для объединения выберите минимум два незакрепленных объекта', 'info');
    return;
  }

  const bounds = deskSelectionBounds(targets.map((d) => d.id));
  if (!bounds) return;
  const defaultName = `Группа ${targets.length} объектов`;
  const label = String(prompt('Название нового общего компонента', defaultName) || '').trim();
  if (!label) return;
  const defaultId = typeof componentEditorCandidateId === 'function'
    ? componentEditorCandidateId(label)
    : componentCandidateId(label);
  const id = safeComponentId(prompt('Component ID нового компонента', defaultId) || '');
  if (!id) {
    edToast('Component ID должен начинаться с буквы/_ и содержать только A-Z, 0-9, _, ., :, -', 'error');
    return;
  }
  if (componentForId(id, null)?.id === id) {
    edToast('Компонент с таким ID уже существует', 'error');
    return;
  }
  const defaultAssetType = targets.some((d) => isWorkplaceObject(d)) && targets.length === 1 ? 'workplace' : 'asset';
  const rawType = String(prompt('Тип общего объекта: workplace, desk, chair, meeting_table, conference_set, asset', defaultAssetType) || defaultAssetType).trim();
  const assetType = ASSET_TYPES.has(rawType) ? rawType : 'asset';
  const svgMarkup = composeSelectedDesksMarkup(targets, bounds);
  if (!svgMarkup || !isSafeSvgMarkup(svgMarkup)) {
    edToast('Не удалось собрать безопасную SVG-разметку из выбранных объектов', 'error');
    return;
  }

  const payload = {
    id,
    label,
    asset_type: assetType,
    view_box: [0, 0, Math.max(1, bounds.w), Math.max(1, bounds.h)],
    default_w: Math.max(1, bounds.w),
    default_h: Math.max(1, bounds.h),
    svg_markup: svgMarkup,
  };

  try {
    await saveCompositeComponent(payload);
    if (typeof loadGlobalComponents === 'function') await loadGlobalComponents();
  } catch (e) {
    edToast(`Ошибка создания компонента: ${e.message}`, 'error');
    return;
  }

  const savedComponent = typeof savedComponentFromPayload === 'function'
    ? savedComponentFromPayload(payload)
    : normalizeComponentRecord({ ...payload, source: 'custom' });
  ensureLayoutComponent(savedComponent);

  const newId = uid();
  const first = targets[0] || {};
  const grouped = {
    id: newId,
    label,
    inventory_number: null,
    name: null,
    team: null,
    dept: null,
    building_id: first.building_id || ld.building_id || null,
    storey_id: first.storey_id || ld.storey_id || null,
    zone_id: first.zone_id || ld.zone_id || null,
    workplace_id: assetType === 'workplace' ? newId : null,
    component_id: id,
    symbol_id: id,
    asset_type: assetType,
    bookable: assetType === 'workplace',
    fixed: false,
    assigned_to: null,
    status: 'available',
    x: bounds.x,
    y: bounds.y,
    w: bounds.w,
    h: bounds.h,
    r: 0,
    locked: false,
  };

  const targetIds = new Set(targets.map((d) => d.id));
  ld.desks = [...(ld.desks || []).filter((d) => !targetIds.has(d.id)), grouped];
  ed.multiDeskIds = [];
  ed.multiStructKeys = [];
  ed.selType = 'desk';
  ed.selId = newId;
  markDirty();
  renderAll();
  showPropsFor('desk', newId);
  if (typeof selectComponentForPlacement === 'function') selectComponentForPlacement(id, { toast: false });
  edToast(`Объединено объектов: ${targets.length}${lockedSkipped ? `. Закреплено и пропущено: ${lockedSkipped}` : ''}`, 'success');
}

function rotateDeskSelectionBy(deltaDeg) {
  const delta = Number(deltaDeg);
  if (!ld || !Number.isFinite(delta) || Math.abs(delta) < 1e-6) return false;

  const selectedIds = selectedDeskIds({ includePrimary: true });
  if (!selectedIds.length) return false;

  const movable = selectedDeskRecords({ includePrimary: true, skipLocked: true });
  const lockedSkipped = selectedIds.length - movable.length;
  if (!movable.length) {
    edToast('Выбранные места закреплены и не могут быть повернуты', 'info');
    return false;
  }

  const box = deskSelectionBounds(selectedIds);
  if (!box) return false;

  const cx = box.x + box.w / 2;
  const cy = box.y + box.h / 2;
  const rad = _degToRad(delta);
  const cos = Math.cos(rad);
  const sin = Math.sin(rad);

  for (const d of movable) {
    const deskCx = d.x + d.w / 2;
    const deskCy = d.y + d.h / 2;
    const vx = deskCx - cx;
    const vy = deskCy - cy;
    const nextCx = cx + vx * cos - vy * sin;
    const nextCy = cy + vx * sin + vy * cos;
    d.x = snapV(nextCx - d.w / 2);
    d.y = snapV(nextCy - d.h / 2);
    d.r = normalizeDeskRotation((d.r || 0) + delta);
  }

  markDirty();
  renderDesks();
  renderSelection();
  renderObjectList();

  if (ed.selType === 'desk' && ed.selId) {
    const active = ld.desks.find((d) => d.id === ed.selId);
    if (active) {
      _v('ep-x', Math.round(active.x));
      _v('ep-y', Math.round(active.y));
      _v('ep-r', Math.round(active.r || 0));
    }
  } else if (hasMultiDeskSelection()) {
    syncDeskBatchPanel();
  }

  if (lockedSkipped > 0) {
    edToast(`Повернуто мест: ${movable.length}. Закреплено и пропущено: ${lockedSkipped}`, 'info');
  }
  return true;
}

function toggleStructLabelAngleField() {
  const field = $el('ep-struct-label-angle-field');
  if (!field) return;
  const orient = String($el('ep-struct-label-orient')?.value || 'horizontal').trim().toLowerCase();
  field.classList.toggle('ed-hidden', orient !== 'angle');
}

function initPropsListeners() {
  const deskTextFields = ['ep-label','ep-inventory-number','ep-name','ep-team','ep-dept','ep-assigned','ep-workplace-id','ep-building-id','ep-storey-id','ep-zone-id'];
  deskTextFields.forEach(fid => {
    $el(fid)?.addEventListener('input', () => applyDeskProps());
    $el(fid)?.addEventListener('change', () => applyDeskProps());
  });
  ['ep-status','ep-asset-type','ep-x','ep-y','ep-w','ep-h','ep-r'].forEach(fid => {
    $el(fid)?.addEventListener('change', () => applyDeskProps());
  });
  $el('ep-symbol')?.addEventListener('change', () => {
    const symbolId = normalizeLayoutSymbolId($el('ep-symbol')?.value);
    _v('ep-asset-type', assetTypeForSymbol(symbolId));
    applyDeskProps();
  });
  ['ep-bookable','ep-fixed','ep-locked'].forEach(fid => {
    $el(fid)?.addEventListener('change', () => applyDeskProps());
  });
  $el('ep-rot-left')?.addEventListener('click', () => rotateDeskSelectionBy(-15));
  $el('ep-rot-right')?.addEventListener('click', () => rotateDeskSelectionBy(15));
  $el('ep-rot-reset')?.addEventListener('click', () => {
    if (ed.selType !== 'desk' || !ed.selId || !ld) return;
    const d = ld.desks.find((x) => x.id === ed.selId);
    if (!d || isDeskLocked(d)) return;
    if (Math.abs(d.r || 0) < 1e-6) return;
    d.r = 0;
    _v('ep-r', 0);
    markDirty();
    renderDesks();
    renderSelection();
    renderObjectList();
  });
  $el('ep-batch-apply')?.addEventListener('click', () => applyDeskBatchProps());
  $el('ep-standard-size')?.addEventListener('click', () => applyStandardSizeToSelectedDesk());
  $el('ep-edit-component-btn')?.addEventListener('click', () => {
    const componentId = $el('ep-symbol')?.value;
    if (!componentId) return;
    switchAdminTab('components');
    if (typeof loadComponentIntoEditor === 'function') loadComponentIntoEditor(componentId);
    if (typeof selectComponentForPlacement === 'function') selectComponentForPlacement(componentId, { toast: false });
  });
  $el('ep-batch-standard-size')?.addEventListener('click', () => applyStandardSizeToSelectedDesks());
  $el('ep-batch-group-component')?.addEventListener('click', () => groupSelectedDesksIntoComponent());

  $el('ep-desk-del')?.addEventListener('click', () => {
    if (!ed.selId || ed.selType !== 'desk') return;
    const d = ld?.desks?.find((x) => x.id === ed.selId);
    if (isDeskLocked(d)) {
      edToast('Объект закреплён: удаление недоступно', 'info');
      return;
    }
    ld.desks = ld.desks.filter(d => d.id !== ed.selId);
    deselect();
    markDirty();
    renderAll();
  });

  // Struct props
  ['ep-struct-type','ep-struct-thick','ep-struct-closed','ep-struct-locked','ep-struct-color','ep-struct-label-size','ep-struct-label-pos','ep-struct-label-orient'].forEach(fid => {
    $el(fid)?.addEventListener('change', () => applyStructProps({ syncForm: true }));
  });
  $el('ep-struct-label-orient')?.addEventListener('change', () => toggleStructLabelAngleField());
  $el('ep-struct-label-angle')?.addEventListener('change', () => applyStructProps({ syncForm: true }));
  $el('ep-struct-label-angle')?.addEventListener('input', () => applyStructProps({ syncForm: false }));
  $el('ep-struct-label-size')?.addEventListener('input', () => applyStructProps({ syncForm: false }));
  $el('ep-struct-label')?.addEventListener('input', () => applyStructProps({ syncForm: false }));
  $el('ep-struct-label')?.addEventListener('change', () => applyStructProps({ syncForm: true }));
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
  d.inventory_number = normalizeEntityId($el('ep-inventory-number')?.value, null);
  d.name        = $el('ep-name')?.value || null;
  d.team        = $el('ep-team')?.value || null;
  d.dept        = $el('ep-dept')?.value || null;
  const componentId = normalizeLayoutSymbolId($el('ep-symbol')?.value || d.component_id || d.symbol_id);
  ensureLayoutComponent(componentForId(componentId, 'desk-short'));
  d.component_id = componentId;
  d.symbol_id = componentId;
  d.asset_type  = normalizeAssetType($el('ep-asset-type')?.value, componentId);
  d.workplace_id = d.asset_type === 'workplace'
    ? normalizeEntityId($el('ep-workplace-id')?.value, d.id)
    : normalizeEntityId($el('ep-workplace-id')?.value, null);
  d.building_id = normalizeEntityId($el('ep-building-id')?.value, null);
  d.storey_id   = normalizeEntityId($el('ep-storey-id')?.value, null);
  d.zone_id     = normalizeEntityId($el('ep-zone-id')?.value, null);
  d.bookable    = d.asset_type === 'workplace' ? !!$el('ep-bookable')?.checked : false;
  d.fixed       = !!$el('ep-fixed')?.checked;
  d.locked      = !!$el('ep-locked')?.checked;
  d.assigned_to = $el('ep-assigned')?.value || null;
  d.status      = $el('ep-status')?.value || 'available';
  const x = _numOrNull('ep-x');
  const y = _numOrNull('ep-y');
  const w = _numOrNull('ep-w');
  const h = _numOrNull('ep-h');
  const r = _numOrNull('ep-r');
  if (x !== null) d.x = x;
  if (y !== null) d.y = y;
  if (w !== null) d.w = Math.max(1, w);
  if (h !== null) d.h = Math.max(1, h);
  if (r !== null) d.r = normalizeDeskRotation(r);
  markDirty();
  renderDesks();
  renderSelection();
  renderObjectList();
}

function applyStructProps(opts = {}) {
  const { syncForm = true } = opts;
  if (!ed.selType || !ed.selId || !ld) return;
  const newType = $el('ep-struct-type')?.value;
  const closed  = !!$el('ep-struct-closed')?.checked;
  const locked  = !!$el('ep-struct-locked')?.checked;
  const zoneLabel = ($el('ep-struct-label')?.value || '').trim();
  const zoneColor = normalizeHexColor($el('ep-struct-color')?.value, DEFAULT_ZONE_COLOR);
  const zoneLabelPos = normalizeLabelPos($el('ep-struct-label-pos')?.value);
  const zoneLabelOrient = $el('ep-struct-label-orient')?.value || 'horizontal';
  const zoneLabelAngleRaw = _numOrNull('ep-struct-label-angle');
  toggleStructLabelAngleField();

  // Find in current array
  const srcArr = ed.selType === 'wall'
    ? ld.walls
    : ed.selType === 'boundary'
      ? ld.boundaries
      : ed.selType === 'partition'
        ? ld.partitions
        : (ld.doors || []);
  const idx = srcArr.findIndex(x => x.id === ed.selId);
  if (idx < 0) return;

  const el = srcArr[idx];
  const thickInput = _numOrNull('ep-struct-thick');
  const thickCurrent = Number(el?.thick);
  const thick = thickInput !== null
    ? Math.max(0.5, Math.min(40, thickInput))
    : (Number.isFinite(thickCurrent) ? thickCurrent : 4);
  const labelSizeInput = _numOrNull('ep-struct-label-size');
  const labelSizeCurrent = Number(el?.label_size);
  const zoneLabelSizeValue = labelSizeInput !== null
    ? Math.max(8, Math.min(120, labelSizeInput))
    : (Number.isFinite(labelSizeCurrent) ? Math.max(8, Math.min(120, labelSizeCurrent)) : defaultZoneLabelSize());
  const labelAngleCurrent = Number.isFinite(Number(el?.label_angle)) ? Number(el.label_angle) : 0;
  const zoneLabelAngle = labelAngleFromInputs(zoneLabelOrient, zoneLabelAngleRaw === null ? labelAngleCurrent : zoneLabelAngleRaw);
  if (syncForm) _v('ep-struct-label-angle', Math.round(zoneLabelAngle));

  el.thick  = thick;
  el.closed = closed;
  el.locked = locked;
  if (ed.selType === 'boundary') {
    el.label = zoneLabel || null;
    el.color = zoneColor;
    el.label_size = zoneLabelSizeValue;
    el.label_pos = zoneLabelPos;
    el.label_angle = zoneLabelAngle;
  } else {
    if (Object.prototype.hasOwnProperty.call(el, 'color')) delete el.color;
    if (Object.prototype.hasOwnProperty.call(el, 'label_size')) delete el.label_size;
    if (Object.prototype.hasOwnProperty.call(el, 'label_pos')) delete el.label_pos;
    if (Object.prototype.hasOwnProperty.call(el, 'label_angle')) delete el.label_angle;
  }

  // If type changed, move to different array
  if (newType && newType !== ed.selType) {
    srcArr.splice(idx, 1);
    const dstArr = newType === 'wall'
      ? ld.walls
      : newType === 'boundary'
        ? ld.boundaries
        : newType === 'partition'
          ? ld.partitions
          : (ld.doors || (ld.doors = []));
    if (newType === 'boundary') {
      el.color = zoneColor;
      el.label = zoneLabel || el.label || null;
      el.label_size = zoneLabelSizeValue;
      el.label_pos = zoneLabelPos;
      el.label_angle = zoneLabelAngle;
    } else {
      if (Object.prototype.hasOwnProperty.call(el, 'color')) delete el.color;
      if (Object.prototype.hasOwnProperty.call(el, 'label_size')) delete el.label_size;
      if (Object.prototype.hasOwnProperty.call(el, 'label_pos')) delete el.label_pos;
      if (Object.prototype.hasOwnProperty.call(el, 'label_angle')) delete el.label_angle;
    }
    dstArr.push(el);
    ed.selType = newType;
  }

  markDirty();
  renderStructure();
  renderObjectList();
  if (syncForm) showPropsFor(ed.selType, ed.selId);
}

function deleteStructEl(type, id) {
  if (!ld || !type || !id) return;
  const el = getStructByTypeId(type, id);
  if (isStructLocked(el)) {
    edToast('Объект закреплён: удаление недоступно', 'info');
    return;
  }
  if (type === 'wall')      ld.walls      = ld.walls.filter(x => x.id !== id);
  if (type === 'boundary')  ld.boundaries = ld.boundaries.filter(x => x.id !== id);
  if (type === 'partition') ld.partitions = ld.partitions.filter(x => x.id !== id);
  if (type === 'door')      ld.doors      = (ld.doors || []).filter(x => x.id !== id);
  deselect();
  markDirty();
  renderAll();
}

function deleteSelectedDesks() {
  if (!ld) return false;
  if (hasMultiDeskSelection()) {
    const ids = new Set(ed.multiDeskIds || []);
    let removed = 0;
    let lockedSkipped = 0;
    ld.desks = (ld.desks || []).filter((d) => {
      if (!ids.has(d.id)) return true;
      if (isDeskLocked(d)) {
        lockedSkipped += 1;
        return true;
      }
      removed += 1;
      return false;
    });
    clearSelectionState();
    if (removed > 0 || lockedSkipped > 0) {
      if (removed > 0) {
        markDirty();
        renderAll();
      } else {
        renderAll();
      }
      if (removed > 0 && lockedSkipped > 0) {
        edToast(`Удалено мест: ${removed}. Закреплено и пропущено: ${lockedSkipped}`, 'info');
      } else if (removed > 0) {
        edToast(`Удалено мест: ${removed}`, 'info');
      } else {
        edToast('Выбранные места закреплены и не могут быть удалены', 'info');
      }
      return removed > 0;
    }
    return false;
  }
  if (ed.selType === 'desk' && ed.selId) {
    const target = (ld.desks || []).find((d) => d.id === ed.selId);
    if (isDeskLocked(target)) {
      edToast('Объект закреплён: удаление недоступно', 'info');
      return false;
    }
    ld.desks = ld.desks.filter(d => d.id !== ed.selId);
    clearSelectionState();
    markDirty();
    renderAll();
    return true;
  }
  return false;
}

function deleteSelectedStructures() {
  if (!ld) return false;
  if (hasMultiStructSelection()) {
    const byType = { wall: new Set(), boundary: new Set(), partition: new Set(), door: new Set() };
    (ed.multiStructKeys || []).forEach((raw) => {
      const parsed = parseStructSelKey(raw);
      if (parsed) byType[parsed.type]?.add(parsed.id);
    });

    const out = { removed: 0, locked: 0, wall: 0, boundary: 0, partition: 0, door: 0 };
    const prune = (arr, type) => (arr || []).filter((el) => {
      if (!byType[type]?.has(el.id)) return true;
      if (isStructLocked(el)) {
        out.locked += 1;
        return true;
      }
      out.removed += 1;
      out[type] += 1;
      return false;
    });

    ld.walls = prune(ld.walls, 'wall');
    ld.boundaries = prune(ld.boundaries, 'boundary');
    ld.partitions = prune(ld.partitions, 'partition');
    ld.doors = prune(ld.doors, 'door');
    clearSelectionState();
    if (out.removed > 0 || out.locked > 0) {
      if (out.removed > 0) {
        markDirty();
        renderAll();
      } else {
        renderAll();
      }
      if (out.removed > 0 && out.locked > 0) {
        edToast(`Удалено: ${out.removed} (стен ${out.wall}, границ ${out.boundary}, перегородок ${out.partition}, дверей ${out.door}). Закреплено: ${out.locked}`, 'info');
      } else if (out.removed > 0) {
        edToast(`Удалено: ${out.removed} (стен ${out.wall}, границ ${out.boundary}, перегородок ${out.partition}, дверей ${out.door})`, 'info');
      } else {
        edToast('Выбранные элементы закреплены и не могут быть удалены', 'info');
      }
      return out.removed > 0;
    }
    return false;
  }
  if (isStructType(ed.selType) && ed.selId) {
    deleteStructEl(ed.selType, ed.selId);
    return true;
  }
  return false;
}

function deleteSelectedMultiObjects() {
  if (!ld) return false;
  const hasDesk = hasMultiDeskSelection();
  const hasStruct = hasMultiStructSelection();
  if (!hasDesk && !hasStruct) return false;

  const selectedDeskIds = new Set(ed.multiDeskIds || []);
  const selectedStructByType = { wall: new Set(), boundary: new Set(), partition: new Set(), door: new Set() };
  (ed.multiStructKeys || []).forEach((raw) => {
    const parsed = parseStructSelKey(raw);
    if (parsed) selectedStructByType[parsed.type]?.add(parsed.id);
  });

  let removedDesks = 0;
  let lockedDesks = 0;
  ld.desks = (ld.desks || []).filter((d) => {
    if (!selectedDeskIds.has(d.id)) return true;
    if (isDeskLocked(d)) {
      lockedDesks += 1;
      return true;
    }
    removedDesks += 1;
    return false;
  });

  const removedStruct = { wall: 0, boundary: 0, partition: 0, door: 0 };
  let lockedStruct = 0;
  const pruneStruct = (arr, type) => (arr || []).filter((el) => {
    if (!selectedStructByType[type]?.has(el.id)) return true;
    if (isStructLocked(el)) {
      lockedStruct += 1;
      return true;
    }
    removedStruct[type] += 1;
    return false;
  });
  ld.walls = pruneStruct(ld.walls, 'wall');
  ld.boundaries = pruneStruct(ld.boundaries, 'boundary');
  ld.partitions = pruneStruct(ld.partitions, 'partition');
  ld.doors = pruneStruct(ld.doors, 'door');

  const totalRemovedStruct = removedStruct.wall + removedStruct.boundary + removedStruct.partition + removedStruct.door;
  const totalRemoved = removedDesks + totalRemovedStruct;
  const totalLocked = lockedDesks + lockedStruct;
  clearSelectionState();
  if (totalRemoved > 0) {
    markDirty();
    renderAll();
  } else {
    renderAll();
  }

  if (totalRemoved > 0 && totalLocked > 0) {
    edToast(`Удалено: ${totalRemoved} (мест ${removedDesks}, стен ${removedStruct.wall}, границ ${removedStruct.boundary}, перегородок ${removedStruct.partition}, дверей ${removedStruct.door}). Закреплено: ${totalLocked}`, 'info');
  } else if (totalRemoved > 0) {
    edToast(`Удалено: ${totalRemoved} (мест ${removedDesks}, стен ${removedStruct.wall}, границ ${removedStruct.boundary}, перегородок ${removedStruct.partition}, дверей ${removedStruct.door})`, 'info');
  } else if (totalLocked > 0) {
    edToast('Выбранные объекты закреплены и не могут быть удалены', 'info');
  }
  return totalRemoved > 0;
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
      if (m.append) {
        if (hit.type === 'desk') toggleDeskMultiSelection(hit.id, { keepStruct: true });
        else if (isStructType(hit.type)) toggleStructMultiSelection(hit.type, hit.id, { keepDesk: true });
      } else {
        selectObj(hit.type, hit.id);
      }
      return true;
    }
    if (!m.append) clearSelectionState();
    renderStructure();
    renderDesks();
    renderSelection();
    renderObjectList();
    showPropsFor(null, null);
    return true;
  }

  const deskIds = (ld.desks || [])
    .filter(d => !(d.x > x2 || d.x + d.w < x1 || d.y > y2 || d.y + d.h < y1))
    .map(d => d.id);
  const structKeys = [];
  STRUCT_TYPES.forEach((type) => {
    const arr = structArrayByType(type) || [];
    arr
      .filter(el => structIntersectsRect(el, x1, y1, x2, y2))
      .forEach((el) => {
        const key = structSelKey(type, el.id);
        if (key) structKeys.push(key);
      });
  });
  setCombinedMultiSelection(deskIds, structKeys, m.append);
  return true;
}

function startGroupDrag(pointerId, startPt) {
  if (!ld) return false;
  const deskIds = new Set(ed.multiDeskIds || []);
  const structKeys = new Set(ed.multiStructKeys || []);

  const desks = (ld.desks || [])
    .filter(d => deskIds.has(d.id) && !isDeskLocked(d))
    .map(d => ({ desk: d, x: d.x, y: d.y }));

  const structs = [];
  structKeys.forEach((raw) => {
    const parsed = parseStructSelKey(raw);
    if (!parsed) return;
    const el = getStructByTypeId(parsed.type, parsed.id);
    if (!el || !Array.isArray(el.pts) || isStructLocked(el)) return;
    structs.push({
      type: parsed.type,
      el,
      pts: el.pts.map(p => [Number(p?.[0] || 0), Number(p?.[1] || 0)]),
    });
  });

  if (!desks.length && !structs.length) {
    edToast('Выбранные объекты закреплены и не могут двигаться', 'info');
    return false;
  }

  ed.dragGroup = { pointerId, startPt, desks, structs, moved: false };
  _svg()?.setPointerCapture(pointerId);
  return true;
}

function updateGroupDrag(pt) {
  const g = ed.dragGroup;
  if (!g) return;
  const dx = pt.x - g.startPt.x;
  const dy = pt.y - g.startPt.y;
  for (const it of (g.desks || [])) {
    it.desk.x = snapV(it.x + dx);
    it.desk.y = snapV(it.y + dy);
  }
  for (const it of (g.structs || [])) {
    it.el.pts = it.pts.map(([x, y]) => [snapV(x + dx), snapV(y + dy)]);
  }
  g.moved = g.moved || Math.abs(dx) > 0.2 || Math.abs(dy) > 0.2;
  if (g.structs?.length) renderStructure();
  if (g.desks?.length) renderDesks();
  renderSelection();
}

function endGroupDrag() {
  if (!ed.dragGroup) return false;
  const moved = !!ed.dragGroup.moved;
  ed.dragGroup = null;
  if (moved) markDirty();
  return moved;
}

function structArrayByType(type) {
  if (!ld) return null;
  if (type === 'wall') return ld.walls;
  if (type === 'boundary') return ld.boundaries;
  if (type === 'partition') return ld.partitions;
  if (type === 'door') return ld.doors || [];
  return null;
}

function startSingleStructDrag(type, id, startPt) {
  if (!ld || !id) return false;
  const arr = structArrayByType(type);
  if (!Array.isArray(arr)) return false;
  const el = arr.find(x => x.id === id);
  if (!el || !Array.isArray(el.pts) || el.pts.length < 2) return false;
  if (isStructLocked(el)) {
    edToast('Объект закреплён и не может быть перемещён', 'info');
    return false;
  }

  const basePts = el.pts.map(p => [Number(p?.[0] || 0), Number(p?.[1] || 0)]);
  let moved = false;

  const onMove = (ev) => {
    const p = svgPt(ev);
    const dx = p.x - startPt.x;
    const dy = p.y - startPt.y;
    el.pts = basePts.map(([x, y]) => [snapV(x + dx), snapV(y + dy)]);
    moved = moved || Math.abs(dx) > 0.2 || Math.abs(dy) > 0.2;
    renderStructure();
    renderSelection();
  };

  const onUp = () => {
    document.removeEventListener('pointermove', onMove);
    document.removeEventListener('pointerup', onUp);
    if (moved) markDirty();
  };

  document.addEventListener('pointermove', onMove);
  document.addEventListener('pointerup', onUp);
  return true;
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

  if (['wall','boundary','partition','door'].includes(ed.mode)) {
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
    placeDeskAt(pt, { componentId: 'workplace-desk-chair', tool: 'desk' });
    return;
  }

  if (ed.mode === 'component') {
    e.preventDefault();
    placeDeskAt(pt, { componentId: ed.componentTool?.componentId || 'chair', tool: 'component' });
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
    updateGroupDrag(pt);
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
    const last = ed.drawing.pts?.[ed.drawing.pts.length - 1];
    ed.drawing.rubberPt = getConstrainedDrawPoint(last, pt, {
      angleLock: !!e.shiftKey,
      angleStepDeg: DRAW_ANGLE_STEP_DEG,
    });
    renderDrawing();
  }
}

function onSvgPointerUp(e) {
  if (ed.bgAdjust.dragging) {
    endBackgroundDrag();
    return;
  }
  if (ed.dragGroup) {
    endGroupDrag();
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

  if (['wall','boundary','partition','door'].includes(ed.mode) && ed.drawing) {
    const pt = svgPt(e);
    const pts = ed.drawing.pts;
    const base = pts?.[pts.length - 1];
    const snapped = getConstrainedDrawPoint(base, pt, {
      angleLock: !!e.shiftKey,
      angleStepDeg: DRAW_ANGLE_STEP_DEG,
    });

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
  if (['wall','partition','door'].includes(ed.mode) && ed.drawing) {
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

function onRotateHandleDown(e, desk) {
  if (ed.mode !== 'select') return;
  if (isDeskLocked(desk)) {
    edToast('Объект закреплён и не может быть изменён', 'info');
    return;
  }
  e.stopPropagation();
  e.preventDefault();
  const captureTarget = _svg();
  try { captureTarget?.setPointerCapture(e.pointerId); } catch {}

  const cx = desk.x + desk.w / 2;
  const cy = desk.y + desk.h / 2;
  const startPt = svgPt(e);
  const startPointerAngle = Math.atan2(startPt.y - cy, startPt.x - cx);
  const startDeskRotation = normalizeDeskRotation(desk.r || 0);
  let moved = false;

  const onMove = (ev) => {
    const p = svgPt(ev);
    const currentPointerAngle = Math.atan2(p.y - cy, p.x - cx);
    let delta = currentPointerAngle - startPointerAngle;
    while (delta > Math.PI) delta -= Math.PI * 2;
    while (delta < -Math.PI) delta += Math.PI * 2;

    const step = ev.shiftKey ? 1 : 5;
    const raw = startDeskRotation + delta * (180 / Math.PI);
    const snapped = Math.round(raw / step) * step;
    const next = normalizeDeskRotation(snapped);
    if (Math.abs(next - (desk.r || 0)) > 1e-6) moved = true;
    desk.r = next;
    _v('ep-r', Math.round(next));
    renderDesks();
    renderSelection();
  };

  const onUp = () => {
    document.removeEventListener('pointermove', onMove);
    document.removeEventListener('pointerup', onUp);
    try { captureTarget?.releasePointerCapture(e.pointerId); } catch {}
    if (moved) {
      markDirty();
      renderObjectList();
    }
  };

  document.addEventListener('pointermove', onMove);
  document.addEventListener('pointerup', onUp);
}

function onMultiDeskRotateHandleDown(e, deskIds) {
  if (ed.mode !== 'select' || !ld) return;
  const ids = Array.isArray(deskIds) ? deskIds.filter(Boolean) : [];
  if (!ids.length) return;

  const targets = (ld.desks || []).filter((d) => ids.includes(d.id) && !isDeskLocked(d));
  if (!targets.length) return;

  e.stopPropagation();
  e.preventDefault();
  const captureTarget = _svg();
  try { captureTarget?.setPointerCapture(e.pointerId); } catch {}

  const box = deskSelectionBounds(ids);
  if (!box) return;
  const cx = box.x + box.w / 2;
  const cy = box.y + box.h / 2;
  const startPt = svgPt(e);
  const startPointerAngle = Math.atan2(startPt.y - cy, startPt.x - cx);
  const snapshots = targets.map((d) => ({
    desk: d,
    cx: d.x + d.w / 2,
    cy: d.y + d.h / 2,
    r: normalizeDeskRotation(d.r || 0),
  }));
  let moved = false;

  const onMove = (ev) => {
    const p = svgPt(ev);
    const currentPointerAngle = Math.atan2(p.y - cy, p.x - cx);
    let delta = currentPointerAngle - startPointerAngle;
    while (delta > Math.PI) delta -= Math.PI * 2;
    while (delta < -Math.PI) delta += Math.PI * 2;

    const step = ev.shiftKey ? 1 : 5;
    const rawDeltaDeg = delta * (180 / Math.PI);
    const snappedDeltaDeg = Math.round(rawDeltaDeg / step) * step;
    const deltaRad = _degToRad(snappedDeltaDeg);
    const cos = Math.cos(deltaRad);
    const sin = Math.sin(deltaRad);
    moved = moved || Math.abs(snappedDeltaDeg) > 1e-6;

    for (const it of snapshots) {
      const vx = it.cx - cx;
      const vy = it.cy - cy;
      const nextCx = cx + vx * cos - vy * sin;
      const nextCy = cy + vx * sin + vy * cos;
      it.desk.x = snapV(nextCx - it.desk.w / 2);
      it.desk.y = snapV(nextCy - it.desk.h / 2);
      it.desk.r = normalizeDeskRotation(it.r + snappedDeltaDeg);
    }

    renderDesks();
    renderSelection();
  };

  const onUp = () => {
    document.removeEventListener('pointermove', onMove);
    document.removeEventListener('pointerup', onUp);
    try { captureTarget?.releasePointerCapture(e.pointerId); } catch {}
    if (!moved) return;
    markDirty();
    renderObjectList();
    syncDeskBatchPanel();
  };

  document.addEventListener('pointermove', onMove);
  document.addEventListener('pointerup', onUp);
}

function onDeskPointerDown(e, desk) {
  if (ed.mode !== 'select') return;
  e.stopPropagation();

  if (e.shiftKey) {
    toggleDeskMultiSelection(desk.id, { keepStruct: true });
    return;
  }

  if ((hasMultiDeskSelection() || hasMultiStructSelection()) && (ed.multiDeskIds || []).includes(desk.id)) {
    const startPt = svgPt(e);
    startGroupDrag(e.pointerId, startPt);
    return;
  }

  selectObj('desk', desk.id);
  if (isDeskLocked(desk)) {
    edToast('Объект закреплён и не может быть перемещён', 'info');
    return;
  }

  const startPt = svgPt(e);
  const sx = desk.x;
  const sy = desk.y;
  let moved = false;

  const onMove = ev => {
    const p = svgPt(ev);
    moved = moved || Math.abs(p.x - startPt.x) > 0.2 || Math.abs(p.y - startPt.y) > 0.2;
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
  if (isDeskLocked(desk)) {
    edToast('Объект закреплён и не может быть изменён', 'info');
    return;
  }
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
  if (e.shiftKey) {
    toggleStructMultiSelection(type, id, { keepDesk: true });
    return;
  }
  const key = structSelKey(type, id);
  if ((hasMultiDeskSelection() || hasMultiStructSelection()) && key && (ed.multiStructKeys || []).includes(key)) {
    const startPt = svgPt(e);
    startGroupDrag(e.pointerId, startPt);
    return;
  }
  selectObj(type, id);
  const el = getStructByTypeId(type, id);
  if (isStructLocked(el)) {
    edToast('Объект закреплён и не может быть перемещён', 'info');
    return;
  }
  startSingleStructDrag(type, id, svgPt(e));
}

/* ── Drawing finish ─────────────────────────────────────────────────────────── */
function finishDrawing(close) {
  if (!ed.drawing) return;
  const { type, pts } = ed.drawing;
  ed.drawing = null;
  const layer = _layer('draw');
  if (layer) layer.innerHTML = '';

  if (pts.length < 2) return;

  const el = {
    id: uid(),
    pts,
    thick: type === 'wall' ? 8 : type === 'partition' ? 3 : type === 'door' ? 2.2 : 2,
    closed: close || type === 'boundary',
    conf: 1.0,
    locked: false,
  };
  if (type === 'boundary') {
    el.label = null;
    el.color = DEFAULT_ZONE_COLOR;
    el.label_size = defaultZoneLabelSize();
    el.label_pos = 'center';
    el.label_angle = 0;
  }

  if (type === 'wall')      ld.walls.push(el);
  else if (type === 'boundary')  ld.boundaries.push(el);
  else if (type === 'partition') ld.partitions.push(el);
  else if (type === 'door') ld.doors = [...(ld.doors || []), el];

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
  const component = componentForId('workplace-desk-chair', 'workplace-desk-chair');
  const inserted = preview.desks.map(r => makeDeskRecord(
    { x: r.x, y: r.y, w: r.w, h: r.h },
    takeNextObjectLabel(used, component),
    { componentId: component.id },
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

function placeDeskAt(pt, opts = {}) {
  if (!ld) return;
  if (ld.desks.length >= MAX_LAYOUT_DESKS) {
    edToast(`Достигнут лимит ${MAX_LAYOUT_DESKS} мест`, 'error');
    return;
  }
  const tool = opts.tool || (ed.mode === 'component' ? 'component' : 'desk');
  const fallback = tool === 'component' ? 'chair' : 'workplace-desk-chair';
  const component = componentForId(opts.componentId || (tool === 'component' ? ed.componentTool?.componentId : 'workplace-desk-chair'), fallback);
  if (tool === 'component') ensureLayoutComponent(component);
  const { w, h } = defaultDeskSize({ componentId: component.id, tool });
  const used = collectDeskNumberSet();
  const desk = makeDeskRecord(
    { x: snapV(pt.x - w / 2), y: snapV(pt.y - h / 2), w, h },
    takeNextObjectLabel(used, component),
    { componentId: component.id },
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
  if (mode === 'desk') {
    ed.deskTool.componentId = 'workplace-desk-chair';
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
  syncComponentPlaceControls();
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
    syncFloorSelects();
    renderAll();
    syncDeskBulkControls();
    syncComponentPlaceControls();
    updateStatusBar();
    updateEditorUI();
    updateLockUI();
    return;
  }

  cancelDeskBlockPreview();
  setBackgroundAdjustMode(false);
    ed.floorId = floorId;
    syncFloorSelects();
    try {
    const resp = await fetch(`${API}/floors/${floorId}/layout`, { headers: ah() });
    if (resp.status === 404) {
      // No layout yet — create empty
      ld = ensureLayoutArrays({ v: 2, vb: [0,0,1000,1000], bg_url: null, bg_transform: null, walls:[], boundaries:[], partitions:[], doors:[], desks:[] });
      ed.status  = null;
      ed.version = 0;
    } else if (!resp.ok) {
      const b = await resp.json().catch(() => ({}));
      edToast('Ошибка загрузки: ' + (b.detail || resp.status), 'error');
      return;
    } else {
      const data = await resp.json();
      ld = ensureLayoutArrays(data.layout);
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

function releaseLockOnExit() {
  if (!ed.floorId || !ed.locked || !isLockOwnedByMe()) return;
  try {
    fetch(`${API}/floors/${ed.floorId}/lock`, {
      method: 'DELETE',
      headers: ah(),
      keepalive: true,
    }).catch(() => {});
  } catch {
    // no-op
  }
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

async function edDownloadSemanticSvg() {
  return edDownloadPublishedArtifact({
    path: 'published.svg',
    ext: 'svg',
    type: 'image/svg+xml;charset=utf-8',
    label: 'XML/SVG',
  });
}

async function edDownloadSemanticHtml() {
  return edDownloadPublishedArtifact({
    path: 'published.html',
    ext: 'html',
    type: 'text/html;charset=utf-8',
    label: 'HTML',
  });
}

async function edDownloadPublishedArtifact(opts) {
  if (!ed.floorId) {
    edToast('Выберите этаж', 'error');
    return;
  }
  const { path, ext, type, label } = opts;
  try {
    const resp = await fetch(`${API}/floors/${ed.floorId}/layout/${path}`, { headers: ah() });
    if (!resp.ok) {
      const b = await resp.json().catch(() => ({}));
      if (resp.status === 404) {
        edToast(`Опубликованного ${label} пока нет. Сначала нажмите "Опубликовать".`, 'info');
      } else {
        edToast('Ошибка скачивания: ' + (b.detail || resp.status), 'error');
      }
      return;
    }

    const text = await resp.text();
    const blob = new Blob([text], { type });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    a.href = url;
    a.download = `deskbook-floor-${ed.floorId}-semantic-${stamp}.${ext}`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
    edToast(`${label} скачан`, 'success');
  } catch (ex) {
    edToast('Ошибка: ' + ex.message, 'error');
  }
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
let _importItems = [];
let _importOverrides = {};
let _importApplied = new Set();
let _importSelected = new Set();
let _importReviewMode = false;
let _importFilters = { conf: 'all', type: 'all', geom: 'all' };
let _importAppliedCounts = { wall: 0, boundary: 0, partition: 0, door: 0, skip: 0 };
const IMPORT_AUTO_THRESHOLD = 70;

function importDefaultType(el) {
  if (!el) return 'skip';
  // uncertain defaults to boundary, but low confidence stays in review flow.
  if (el._type === 'uncertain') return 'boundary';
  return el._type || 'skip';
}

function importTypeLabel(type) {
  if (type === 'wall') return 'Стена';
  if (type === 'boundary') return 'Граница';
  if (type === 'partition') return 'Перегородка';
  if (type === 'door') return 'Дверь';
  return 'Пропуск';
}

function importKindClass(type) {
  return type === 'wall' || type === 'boundary' || type === 'partition' || type === 'door' ? type : 'skip';
}

function importConfColor(confPct) {
  return confPct >= 70 ? '#22c55e' : confPct >= 40 ? '#f59e0b' : '#ef4444';
}

function resetImportState() {
  _importResult = null;
  _importItems = [];
  _importOverrides = {};
  _importApplied = new Set();
  _importSelected = new Set();
  _importReviewMode = false;
  _importFilters = { conf: 'all', type: 'all', geom: 'all' };
  _importAppliedCounts = { wall: 0, boundary: 0, partition: 0, door: 0, skip: 0 };
}

function importPtsLength(pts) {
  if (!Array.isArray(pts) || pts.length < 2) return 0;
  let total = 0;
  for (let i = 1; i < pts.length; i += 1) {
    const a = pts[i - 1];
    const b = pts[i];
    total += Math.hypot(Number(b?.[0] || 0) - Number(a?.[0] || 0), Number(b?.[1] || 0) - Number(a?.[1] || 0));
  }
  return total;
}

function importReason(el) {
  const closed = !!el?.closed;
  const len = Math.round(importPtsLength(el?.pts || []));
  const thick = Number(el?.thick);
  const rawFill = String(el?.color || '').trim().toLowerCase();
  const hasFill = !!rawFill
    && rawFill !== 'none'
    && rawFill !== 'transparent'
    && rawFill !== '#00000000'
    && !/^rgba\(\s*\d+\s*,\s*\d+\s*,\s*\d+\s*,\s*0(?:\.0+)?\s*\)$/.test(rawFill);
  const thickTxt = Number.isFinite(thick) ? `толщина ${thick.toFixed(1)}` : 'толщина n/a';
  const geomTxt = closed ? 'замкнутый контур (зона/fill)' : 'открытая линия';
  const fillTxt = closed ? (hasFill ? 'fill есть' : 'fill нет') : 'fill n/a';
  return `${geomTxt} · ${fillTxt} · ${thickTxt} · длина ${len}`;
}

function buildImportItems(res) {
  const all = [
    ...((res.walls || []).map(e => ({ ...e, _type: 'wall' }))),
    ...((res.boundaries || []).map(e => ({ ...e, _type: 'boundary' }))),
    ...((res.partitions || []).map(e => ({ ...e, _type: 'partition' }))),
    ...((res.doors || []).map(e => ({ ...e, _type: 'door' }))),
    ...((res.uncertain || []).map(e => ({ ...e, _type: 'uncertain' }))),
  ];
  return all.map((el, idx) => {
    const confPct = Math.max(0, Math.min(100, Math.round(Number(el?.conf || 0) * 100)));
    return {
      ...el,
      _idx: idx,
      _confPct: confPct,
      _len: importPtsLength(el?.pts || []),
      _reason: importReason(el),
    };
  });
}

function importCurrentType(idx) {
  const el = _importItems[idx];
  return _importOverrides[idx] || importDefaultType(el);
}

function importAutoIndices() {
  return _importItems
    .filter(el => Number(el?._confPct || 0) >= IMPORT_AUTO_THRESHOLD)
    .map(el => el._idx);
}

function importReviewIndices() {
  return _importItems
    .filter(el => Number(el?._confPct || 0) < IMPORT_AUTO_THRESHOLD)
    .map(el => el._idx);
}

function importVisibleIndices() {
  const base = (_importReviewMode ? importReviewIndices() : _importItems.map(el => el._idx))
    .filter(idx => !_importApplied.has(idx));
  return base.filter((idx) => {
    const el = _importItems[idx];
    if (!el) return false;
    const conf = Number(el._confPct || 0);
    if (_importFilters.conf === 'lt40' && !(conf < 40)) return false;
    if (_importFilters.conf === '40to69' && !(conf >= 40 && conf < 70)) return false;
    if (_importFilters.conf === 'gte70' && !(conf >= 70)) return false;
    const type = importCurrentType(idx);
    if (_importFilters.type !== 'all' && _importFilters.type !== type) return false;
    if (_importFilters.geom === 'open' && el.closed) return false;
    if (_importFilters.geom === 'closed' && !el.closed) return false;
    return true;
  });
}

function syncImportSummary() {
  const summaryEl = $el('ed-import-summary');
  if (!summaryEl || !_importItems.length) return;
  const autoTotal = importAutoIndices().length;
  const autoPending = importAutoIndices().filter(idx => !_importApplied.has(idx)).length;
  const reviewTotal = importReviewIndices().length;
  const reviewPending = importReviewIndices().filter(idx => !_importApplied.has(idx)).length;
  summaryEl.textContent =
    `Авто (≥${IMPORT_AUTO_THRESHOLD}%): ${autoTotal - autoPending}/${autoTotal} применено · ` +
    `Review (<${IMPORT_AUTO_THRESHOLD}%): ${reviewPending}/${reviewTotal} осталось` +
    (_importSelected.size ? ` · Выделено: ${_importSelected.size}` : '');
}

function updateImportActionButtons() {
  const autoBtn = $el('ed-import-apply-auto');
  const reviewBtn = $el('ed-import-review');
  const applyReviewBtn = $el('ed-import-apply-review');
  const reviewControls = $el('ed-import-review-controls');
  const hasData = !!_importResult && _importItems.length > 0;

  [autoBtn, reviewBtn, applyReviewBtn].forEach((btn) => {
    if (!btn) return;
    btn.classList.toggle('ed-hidden', !hasData);
  });
  if (!hasData) {
    reviewControls?.classList.add('ed-hidden');
    return;
  }

  const autoPending = importAutoIndices().filter(idx => !_importApplied.has(idx)).length;
  const reviewPending = importReviewIndices().filter(idx => !_importApplied.has(idx)).length;
  if (autoBtn) {
    autoBtn.textContent = `Применить авто (${autoPending})`;
    autoBtn.disabled = autoPending === 0;
  }
  if (reviewBtn) {
    reviewBtn.textContent = `Проверить спорные (${reviewPending})`;
    reviewBtn.disabled = reviewPending === 0;
  }
  if (applyReviewBtn) {
    applyReviewBtn.disabled = reviewPending === 0;
    applyReviewBtn.classList.toggle('ed-hidden', !_importReviewMode);
  }
  reviewControls?.classList.toggle('ed-hidden', !_importReviewMode);
}

function renderImportRows() {
  const itemsEl = $el('ed-import-items');
  if (!itemsEl) return;
  const visible = importVisibleIndices();
  if (!visible.length) {
    itemsEl.innerHTML = '<div class="ed-history-empty">Нет элементов по текущим фильтрам.</div>';
    return;
  }
  itemsEl.innerHTML = visible.map((idx) => {
    const el = _importItems[idx];
    const type = importCurrentType(idx);
    const confPct = Number(el?._confPct || 0);
    const confColor = importConfColor(confPct);
    const lowClass = confPct < IMPORT_AUTO_THRESHOLD ? ' low' : '';
    const selectedClass = _importSelected.has(idx) ? ' selected' : '';
    const kindClass = importKindClass(type);
    const ptsCount = Array.isArray(el?.pts) ? el.pts.length : 0;
    return `<div class="ed-import-row${lowClass}${selectedClass}" data-import-idx="${idx}">
      <input type="checkbox" class="ed-import-check" data-import-check="${idx}" ${_importSelected.has(idx) ? 'checked' : ''}>
      <select data-import-idx="${idx}" class="ed-import-type">
        <option value="wall"      ${type === 'wall' ? 'selected' : ''}>Стена</option>
        <option value="boundary"  ${type === 'boundary' ? 'selected' : ''}>Граница</option>
        <option value="partition" ${type === 'partition' ? 'selected' : ''}>Перегородка</option>
        <option value="door"      ${type === 'door' ? 'selected' : ''}>Дверь</option>
        <option value="skip"      ${type === 'skip' ? 'selected' : ''}>Пропустить</option>
      </select>
      <div class="ed-import-meta">
        <span class="ed-import-kind ${kindClass}" data-import-kind="${idx}">${importTypeLabel(type)}</span>
        <span class="ed-import-pts">${ptsCount} pts · ${Math.round(el._len || 0)} u</span>
        <span class="ed-import-reason">${el._reason}</span>
      </div>
      <span class="ed-import-conf" style="color:${confColor}">${confPct}%</span>
      <div class="ed-conf-bar"><div class="ed-conf-fill" style="width:${confPct}%;background:${confColor}"></div></div>
    </div>`;
  }).join('');
}

function applyImportItems(indices) {
  if (!_importResult || !ld || !Array.isArray(indices) || !indices.length) {
    return { wall: 0, boundary: 0, partition: 0, door: 0, skip: 0, added: 0 };
  }

  const before = _importApplied.size;
  if (_importResult.vb && before === 0) ld.vb = _importResult.vb;
  if (!Array.isArray(ld.walls)) ld.walls = [];
  if (!Array.isArray(ld.boundaries)) ld.boundaries = [];
  if (!Array.isArray(ld.partitions)) ld.partitions = [];
  if (!Array.isArray(ld.doors)) ld.doors = [];

  const out = { wall: 0, boundary: 0, partition: 0, door: 0, skip: 0, added: 0 };
  indices.forEach((idx) => {
    if (_importApplied.has(idx)) return;
    const el = _importItems[idx];
    if (!el) return;
    const type = importCurrentType(idx);
    _importApplied.add(idx);
    if (type === 'skip') {
      out.skip += 1;
      _importAppliedCounts.skip += 1;
      return;
    }
    const item = {
      id: uid(),
      pts: el.pts,
      thick: el.thick || 4,
      closed: !!el.closed,
      conf: el.conf,
      label: el.label || null,
      locked: false,
    };
    if (type === 'boundary') {
      item.color = normalizeHexColor(el.color, DEFAULT_ZONE_COLOR);
      item.label_size = Number.isFinite(Number(el.label_size))
        ? Math.max(8, Math.min(120, Number(el.label_size)))
        : defaultZoneLabelSize();
    }
    if (type === 'wall')      { ld.walls.push(item); out.wall += 1; out.added += 1; _importAppliedCounts.wall += 1; }
    if (type === 'boundary')  { ld.boundaries.push(item); out.boundary += 1; out.added += 1; _importAppliedCounts.boundary += 1; }
    if (type === 'partition') { ld.partitions.push(item); out.partition += 1; out.added += 1; _importAppliedCounts.partition += 1; }
    if (type === 'door')      { ld.doors.push(item); out.door += 1; out.added += 1; _importAppliedCounts.door += 1; }
  });
  return out;
}

function renderImportPreview() {
  const layer = _layer('import-preview');
  if (!layer) return;
  layer.innerHTML = '';

  const overlay = $el('ed-import-overlay');
  if (!_importResult || !overlay || overlay.classList.contains('ed-hidden') || !_importItems.length) return;
  const sw = Math.max(1.05, ed.vb.w * 0.0011);

  for (let i = 0; i < _importItems.length; i += 1) {
    if (_importApplied.has(i)) continue;
    const el = _importItems[i];
    const pts = Array.isArray(el?.pts) ? el.pts : [];
    if (pts.length < 2) continue;

    const type = importCurrentType(i);
    const confPct = Number(el?._confPct || 0);
    const lowConf = confPct < IMPORT_AUTO_THRESHOLD;
    const tag = el.closed ? 'polygon' : 'polyline';
    const shape = _makePolyEl(tag, pts, !!el.closed);

    shape.setAttribute('pointer-events', 'none');
    shape.setAttribute('stroke-linecap', 'butt');
    shape.setAttribute('stroke-linejoin', 'round');

    if (type === 'wall') {
      shape.setAttribute('fill', 'none');
      shape.setAttribute('stroke', STRUCT_COLORS.wall);
      shape.setAttribute('stroke-width', String(sw * 1.35));
    } else if (type === 'boundary') {
      shape.setAttribute('fill', el.closed ? '#1d4ed8' : 'none');
      shape.setAttribute('fill-opacity', el.closed ? '0.08' : '0');
      shape.setAttribute('stroke', '#1d4ed8');
      shape.setAttribute('stroke-width', String(sw));
    } else if (type === 'partition') {
      shape.setAttribute('fill', 'none');
      shape.setAttribute('stroke', STRUCT_COLORS.partition);
      shape.setAttribute('stroke-width', String(sw * 0.95));
      shape.setAttribute('stroke-dasharray', '7 4');
    } else if (type === 'door') {
      shape.setAttribute('fill', 'none');
      shape.setAttribute('stroke', STRUCT_COLORS.door);
      shape.setAttribute('stroke-width', String(sw));
    } else {
      shape.setAttribute('fill', 'none');
      shape.setAttribute('stroke', '#94a3b8');
      shape.setAttribute('stroke-width', String(sw * 0.85));
      shape.setAttribute('stroke-dasharray', '4 4');
    }

    if (lowConf) {
      shape.setAttribute('opacity', type === 'skip' ? '0.72' : '0.88');
      if (type !== 'skip' && !shape.getAttribute('stroke-dasharray')) {
        shape.setAttribute('stroke-dasharray', '4 3');
      }
    } else {
      shape.setAttribute('opacity', type === 'skip' ? '0.56' : '0.95');
    }

    layer.appendChild(shape);
  }
}

function applyImportAuto(opts = {}) {
  const pending = importAutoIndices().filter(idx => !_importApplied.has(idx));
  if (!pending.length) {
    if (!opts.silent) edToast('Авто-элементы уже применены', 'info');
    return;
  }
  const before = _importApplied.size;
  const out = applyImportItems(pending);
  if (out.added > 0) {
    markDirty();
    if (before === 0) fitToScreen();
    renderAll();
  }
  if (!opts.silent) {
    edToast(`Авто применено: ${out.wall} стен, ${out.boundary} границ, ${out.partition} перегородок, ${out.door} дверей`, 'success');
  }
  syncImportSummary();
  updateImportActionButtons();
  renderImportRows();
  renderImportPreview();
}

function openImportReview() {
  _importReviewMode = true;
  _importSelected.clear();
  _importFilters.conf = 'all';
  const confSel = $el('ed-import-filter-conf');
  if (confSel) confSel.value = _importFilters.conf;
  syncImportSummary();
  updateImportActionButtons();
  renderImportRows();
  renderImportPreview();
}

function applyImportReview() {
  if (!_importResult || !ld) return;
  if (importAutoIndices().some(idx => !_importApplied.has(idx))) {
    applyImportAuto({ silent: true });
  }
  const pending = importReviewIndices().filter(idx => !_importApplied.has(idx));
  if (!pending.length) {
    closeImportModal();
    edToast('Спорных элементов не осталось', 'info');
    return;
  }
  const before = _importApplied.size;
  const out = applyImportItems(pending);
  if (out.added > 0) {
    markDirty();
    if (before === 0) fitToScreen();
    renderAll();
  }
  const totalApplied = _importAppliedCounts.wall + _importAppliedCounts.boundary + _importAppliedCounts.partition + _importAppliedCounts.door;
  closeImportModal();
  edToast(
    `Импорт завершён: применено ${totalApplied} элементов (${_importAppliedCounts.wall} стен, ${_importAppliedCounts.boundary} границ, ${_importAppliedCounts.partition} перегородок, ${_importAppliedCounts.door} дверей)`,
    'success',
  );
}

function setImportFilter(key, value) {
  if (!['conf', 'type', 'geom'].includes(key)) return;
  _importFilters[key] = value;
  _importSelected.clear();
  syncImportSummary();
  renderImportRows();
  renderImportPreview();
}

function selectVisibleImportRows() {
  importVisibleIndices().forEach(idx => _importSelected.add(idx));
  syncImportSummary();
  renderImportRows();
}

function clearImportSelection() {
  _importSelected.clear();
  syncImportSummary();
  renderImportRows();
}

function bulkAssignImportType(type) {
  const visible = importVisibleIndices().filter(idx => !_importApplied.has(idx));
  const target = (_importSelected.size ? [..._importSelected] : visible).filter(idx => !_importApplied.has(idx));
  if (!target.length) {
    edToast('Нет элементов для пакетного назначения', 'info');
    return;
  }
  target.forEach((idx) => { _importOverrides[idx] = type; });
  syncImportSummary();
  renderImportRows();
  renderImportPreview();
  edToast(`Назначено "${importTypeLabel(type)}" для ${target.length} элементов`, 'info');
}

function bindImportListEvents() {
  const itemsEl = $el('ed-import-items');
  if (!itemsEl || itemsEl._importEventsBound) return;
  itemsEl.addEventListener('change', (e) => {
    const sel = e.target.closest('select[data-import-idx]');
    if (sel) {
      const idx = Number(sel.dataset.importIdx);
      if (Number.isFinite(idx)) _importOverrides[idx] = sel.value;
      syncImportSummary();
      renderImportRows();
      renderImportPreview();
      return;
    }
    const chk = e.target.closest('input[data-import-check]');
    if (!chk) return;
    const idx = Number(chk.dataset.importCheck);
    if (!Number.isFinite(idx)) return;
    if (chk.checked) _importSelected.add(idx); else _importSelected.delete(idx);
    syncImportSummary();
    renderImportRows();
  });
  itemsEl.addEventListener('click', (e) => {
    if (e.target.closest('select') || e.target.closest('input[data-import-check]')) return;
    const row = e.target.closest('.ed-import-row[data-import-idx]');
    if (!row) return;
    const idx = Number(row.dataset.importIdx);
    if (!Number.isFinite(idx)) return;
    if (_importSelected.has(idx)) _importSelected.delete(idx); else _importSelected.add(idx);
    syncImportSummary();
    renderImportRows();
  });
  itemsEl._importEventsBound = true;
}

function svgLocalName(node) {
  return String(node?.localName || node?.tagName || '').split(':').pop().toLowerCase();
}

function parseSvgNumberList(value) {
  return String(value || '')
    .match(/-?\d*\.?\d+(?:e[-+]?\d+)?/gi)
    ?.map((n) => Number(n))
    .filter(Number.isFinite) || [];
}

function parseSvgViewBox(value, fallback = [0, 0, 1000, 1000]) {
  const nums = parseSvgNumberList(value);
  if (nums.length >= 4 && nums[2] > 0 && nums[3] > 0) return nums.slice(0, 4);
  return fallback.slice();
}

function attrNum(node, name, fallback = 0) {
  const value = Number(node?.getAttribute?.(name));
  return Number.isFinite(value) ? value : fallback;
}

function getLocalHrefId(node) {
  const raw = String(node?.getAttribute?.('href') || node?.getAttribute?.('xlink:href') || '').trim();
  if (!/^#[A-Za-z_][A-Za-z0-9_.:-]{0,119}$/.test(raw)) return null;
  return raw.slice(1);
}

function extractSvgSourceFromText(text) {
  const raw = String(text || '');
  if (!raw.trim()) return null;
  const parser = new DOMParser();
  let doc = parser.parseFromString(raw, 'text/html');
  let svg = doc.querySelector('svg');
  if (!svg && /^\s*<svg[\s>]/i.test(raw)) {
    doc = parser.parseFromString(raw, 'image/svg+xml');
    if (!doc.querySelector('parsererror')) svg = doc.documentElement;
  }
  if (!svg || svgLocalName(svg) !== 'svg') return null;
  const serializer = new XMLSerializer();
  return { svg, svgText: serializer.serializeToString(svg) };
}

function inferComponentAssetType(id, fallback = 'asset') {
  const raw = String(id || '').toLowerCase();
  if (raw.includes('meeting') || raw.includes('conference')) return raw.includes('chair') ? 'chair' : 'meeting_table';
  if (raw.includes('chair') || raw.includes('seat')) return 'chair';
  if (raw.includes('desk') || raw.includes('table')) return 'desk';
  if (raw.includes('workstation') || raw.includes('workplace') || raw.includes('furniture') || raw.includes('room')) return 'workplace';
  return fallback;
}

function copyImportSafeAttrs(src, out, opts = {}) {
  Array.from(src?.attributes || []).forEach((attr) => {
    const name = String(attr.localName || attr.name || '').toLowerCase();
    const value = String(attr.value || '').trim();
    const lower = value.toLowerCase();
    if (!SVG_RENDER_ATTRS.has(name)) return;
    if (name.startsWith('on') || lower.includes('javascript:') || lower.includes('url(')) return;
    if (/[\r\n\t]/.test(value)) return;
    if ((name === 'href' || name === 'xlink:href') && !/^#[A-Za-z_][A-Za-z0-9_.:-]{0,119}$/.test(value)) return;
    if (name === 'id' && opts.dropId) return;
    out.setAttribute(name === 'xlink:href' ? 'href' : name, name === 'class' ? safeSvgClassList(value) : value);
  });
}

function cloneImportSvgNode(node, symbolMap, depth = 0) {
  const tag = svgLocalName(node);
  if (!SVG_RENDER_TAGS.has(tag)) return null;

  if (tag === 'use') {
    const refId = getLocalHrefId(node);
    const target = refId ? symbolMap.get(refId) : null;
    if (target && depth < 8) {
      const targetVb = parseSvgViewBox(target.getAttribute('viewBox'), [0, 0, attrNum(node, 'width', 100), attrNum(node, 'height', 60)]);
      const [vx, vy, vw, vh] = targetVb;
      const x = attrNum(node, 'x', 0);
      const y = attrNum(node, 'y', 0);
      const w = Math.max(1, attrNum(node, 'width', vw));
      const h = Math.max(1, attrNum(node, 'height', vh));
      const group = document.createElementNS(NS, 'g');
      copyImportSafeAttrs(node, group, { dropId: true });
      group.removeAttribute('href');
      const transform = [
        node.getAttribute('transform') || '',
        `translate(${x} ${y}) scale(${w / vw} ${h / vh}) translate(${-vx} ${-vy})`,
      ].filter(Boolean).join(' ');
      group.setAttribute('transform', transform);
      Array.from(target.children || []).forEach((child) => {
        const clean = cloneImportSvgNode(child, symbolMap, depth + 1);
        if (clean) group.appendChild(clean);
      });
      return group.childNodes.length ? group : null;
    }
  }

  const out = document.createElementNS(NS, tag);
  copyImportSafeAttrs(node, out);
  if (tag === 'text') out.textContent = String(node.textContent || '').slice(0, 300);
  Array.from(node.children || []).forEach((child) => {
    const clean = cloneImportSvgNode(child, symbolMap, depth);
    if (clean) out.appendChild(clean);
  });
  return out;
}

function serializeImportSvgChildren(children, symbolMap) {
  const serializer = new XMLSerializer();
  const out = [];
  Array.from(children || []).forEach((child) => {
    const clean = cloneImportSvgNode(child, symbolMap, 0);
    if (clean) out.push(serializer.serializeToString(clean));
  });
  const markup = out.join('\n');
  return isSafeSvgMarkup(markup) ? markup : '';
}

function parseImportTransform(value) {
  const raw = String(value || '');
  let tx = 0;
  let ty = 0;
  let sx = 1;
  let sy = 1;
  let r = 0;
  for (const match of raw.matchAll(/translate\(\s*(-?\d*\.?\d+(?:e[-+]?\d+)?)(?:[,\s]+(-?\d*\.?\d+(?:e[-+]?\d+)?))?/ig)) {
    tx += Number(match[1]) || 0;
    ty += Number(match[2]) || 0;
  }
  for (const match of raw.matchAll(/scale\(\s*(-?\d*\.?\d+(?:e[-+]?\d+)?)(?:[,\s]+(-?\d*\.?\d+(?:e[-+]?\d+)?))?/ig)) {
    const nextSx = Number(match[1]);
    const nextSy = match[2] === undefined ? nextSx : Number(match[2]);
    if (Number.isFinite(nextSx) && nextSx !== 0) sx *= nextSx;
    if (Number.isFinite(nextSy) && nextSy !== 0) sy *= nextSy;
  }
  const rotations = [...raw.matchAll(/rotate\(\s*(-?\d*\.?\d+(?:e[-+]?\d+)?)/ig)];
  if (rotations.length) r = Number(rotations[rotations.length - 1][1]) || 0;
  return { tx, ty, sx, sy, r: normalizeDeskRotation(r) };
}

function mergeBounds(a, b) {
  if (!b) return a;
  if (!a) return { ...b };
  const x1 = Math.min(a.x, b.x);
  const y1 = Math.min(a.y, b.y);
  const x2 = Math.max(a.x + a.w, b.x + b.w);
  const y2 = Math.max(a.y + a.h, b.y + b.h);
  return { x: x1, y: y1, w: Math.max(1, x2 - x1), h: Math.max(1, y2 - y1) };
}

function pointsBounds(points) {
  const nums = parseSvgNumberList(points);
  if (nums.length < 2) return null;
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (let i = 0; i < nums.length - 1; i += 2) {
    const x = nums[i], y = nums[i + 1];
    minX = Math.min(minX, x); minY = Math.min(minY, y);
    maxX = Math.max(maxX, x); maxY = Math.max(maxY, y);
  }
  if (![minX, minY, maxX, maxY].every(Number.isFinite)) return null;
  return { x: minX, y: minY, w: Math.max(1, maxX - minX), h: Math.max(1, maxY - minY) };
}

function approximateSvgNodeBounds(node, symbolMap) {
  const tag = svgLocalName(node);
  if (!SVG_RENDER_TAGS.has(tag)) return null;
  if (tag === 'rect') {
    return { x: attrNum(node, 'x', 0), y: attrNum(node, 'y', 0), w: Math.max(1, attrNum(node, 'width', 1)), h: Math.max(1, attrNum(node, 'height', 1)) };
  }
  if (tag === 'circle') {
    const r = Math.max(0, attrNum(node, 'r', 0));
    return { x: attrNum(node, 'cx', 0) - r, y: attrNum(node, 'cy', 0) - r, w: Math.max(1, r * 2), h: Math.max(1, r * 2) };
  }
  if (tag === 'ellipse') {
    const rx = Math.max(0, attrNum(node, 'rx', 0));
    const ry = Math.max(0, attrNum(node, 'ry', 0));
    return { x: attrNum(node, 'cx', 0) - rx, y: attrNum(node, 'cy', 0) - ry, w: Math.max(1, rx * 2), h: Math.max(1, ry * 2) };
  }
  if (tag === 'line') {
    const x1 = attrNum(node, 'x1', 0), y1 = attrNum(node, 'y1', 0), x2 = attrNum(node, 'x2', 0), y2 = attrNum(node, 'y2', 0);
    return { x: Math.min(x1, x2), y: Math.min(y1, y2), w: Math.max(1, Math.abs(x2 - x1)), h: Math.max(1, Math.abs(y2 - y1)) };
  }
  if (tag === 'polyline' || tag === 'polygon') return pointsBounds(node.getAttribute('points'));
  if (tag === 'path') return pointsBounds(node.getAttribute('d'));
  if (tag === 'use') {
    const refId = getLocalHrefId(node);
    const target = refId ? symbolMap.get(refId) : null;
    const targetVb = target ? parseSvgViewBox(target.getAttribute('viewBox'), [0, 0, 100, 60]) : [0, 0, 100, 60];
    return {
      x: attrNum(node, 'x', 0),
      y: attrNum(node, 'y', 0),
      w: Math.max(1, attrNum(node, 'width', targetVb[2])),
      h: Math.max(1, attrNum(node, 'height', targetVb[3])),
    };
  }
  let bounds = null;
  Array.from(node.children || []).forEach((child) => {
    bounds = mergeBounds(bounds, approximateSvgNodeBounds(child, symbolMap));
  });
  return bounds;
}

function firstDirectUse(node) {
  return Array.from(node?.children || []).find((child) => svgLocalName(child) === 'use') || null;
}

function workplaceLocalBounds(wp, symbolMap, component) {
  const use = firstDirectUse(wp);
  if (use && component) {
    const vb = Array.isArray(component.view_box) ? component.view_box : [0, 0, 100, 60];
    return {
      x: attrNum(use, 'x', 0),
      y: attrNum(use, 'y', 0),
      w: Math.max(1, attrNum(use, 'width', component.default_w || vb[2] || 100)),
      h: Math.max(1, attrNum(use, 'height', component.default_h || vb[3] || 60)),
    };
  }
  const hit = wp.querySelector('.workplace-hit');
  if (hit && svgLocalName(hit) === 'rect') {
    return {
      x: attrNum(hit, 'x', 0),
      y: attrNum(hit, 'y', 0),
      w: Math.max(1, attrNum(hit, 'width', 1)),
      h: Math.max(1, attrNum(hit, 'height', 1)),
    };
  }
  return approximateSvgNodeBounds(wp, symbolMap) || { x: 0, y: 0, w: 100, h: 60 };
}

function normalizeImportStatus(value) {
  const raw = String(value || '').toLowerCase();
  if (raw === 'disabled') return 'disabled';
  if (raw === 'occupied' || raw === 'booked' || raw === 'reserved') return 'occupied';
  return 'available';
}

function buildComponentizedLayoutImport(text) {
  const source = extractSvgSourceFromText(text);
  if (!source) return null;
  const { svg } = source;
  const workplaces = Array.from(svg.querySelectorAll('.workplace, [data-workplace-id]'))
    .filter((node) => svgLocalName(node) === 'g');
  if (!workplaces.length) return null;

  const vb = parseSvgViewBox(
    svg.getAttribute('viewBox'),
    [0, 0, Math.max(1, attrNum(svg, 'width', 1000)), Math.max(1, attrNum(svg, 'height', 1000))],
  );
  const symbolMap = new Map();
  svg.querySelectorAll('defs symbol[id]').forEach((symbol) => {
    const id = safeComponentId(symbol.getAttribute('id'));
    if (id && !symbolMap.has(id)) symbolMap.set(id, symbol);
  });

  const components = [];
  const componentById = new Map();
  const addComponent = (component) => {
    const normalized = normalizeComponentRecord(component);
    if (!normalized || normalized.source !== 'custom') return null;
    if (BUILTIN_COMPONENT_IDS.has(normalized.id) || componentById.has(normalized.id)) return componentById.get(normalized.id) || null;
    if (!normalized.svg_markup || !isSafeSvgMarkup(normalized.svg_markup)) return null;
    components.push(normalized);
    componentById.set(normalized.id, normalized);
    return normalized;
  };

  symbolMap.forEach((symbol, id) => {
    const viewBox = parseSvgViewBox(symbol.getAttribute('viewBox'), [0, 0, 100, 60]);
    addComponent({
      id,
      label: id.replace(/^component-/, '').replace(/[-_]+/g, ' '),
      asset_type: inferComponentAssetType(id),
      source: 'custom',
      view_box: viewBox,
      default_w: viewBox[2],
      default_h: viewBox[3],
      svg_markup: serializeImportSvgChildren(symbol.children, symbolMap),
    });
  });

  const desks = [];
  const usedWorkplaceIds = new Set();
  let firstBuilding = null;
  let firstStorey = null;
  let firstZone = null;

  workplaces.forEach((wp, idx) => {
    const use = firstDirectUse(wp);
    const useRef = getLocalHrefId(use);
    const rawComponentId = safeComponentId(wp.getAttribute('data-component'));
    let componentId = rawComponentId && componentById.has(rawComponentId) ? rawComponentId : (useRef || rawComponentId);
    if (!safeComponentId(componentId)) {
      componentId = componentCandidateId(wp.getAttribute('data-workplace-id') || wp.id || `imported-workplace-${idx + 1}`);
    }

    let component = componentById.get(componentId);
    if (!component) {
      const localBounds = workplaceLocalBounds(wp, symbolMap, null);
      const markup = serializeImportSvgChildren(wp.children, symbolMap);
      component = addComponent({
        id: componentId,
        label: componentId.replace(/^component-/, '').replace(/[-_]+/g, ' '),
        asset_type: 'workplace',
        source: 'custom',
        view_box: [localBounds.x, localBounds.y, localBounds.w, localBounds.h],
        default_w: localBounds.w,
        default_h: localBounds.h,
        svg_markup: markup,
      });
    }
    if (!component) return;

    const transform = parseImportTransform(wp.getAttribute('transform'));
    const bounds = workplaceLocalBounds(wp, symbolMap, component);
    const workplaceId = normalizeEntityId(wp.getAttribute('data-workplace-id') || wp.id || `wp-${idx + 1}`, `wp-${idx + 1}`);
    const buildingId = normalizeEntityId(wp.getAttribute('data-building-id') || wp.getAttribute('data-building'), null);
    const storeyId = normalizeEntityId(wp.getAttribute('data-storey-id') || wp.getAttribute('data-storey'), null);
    const zoneId = normalizeEntityId(wp.getAttribute('data-zone-id') || wp.getAttribute('data-zone'), null);
    if (!firstBuilding && buildingId) firstBuilding = buildingId;
    if (!firstStorey && storeyId) firstStorey = storeyId;
    if (!firstZone && zoneId) firstZone = zoneId;

    let uniqueWorkplaceId = workplaceId;
    let suffix = 2;
    while (usedWorkplaceIds.has(uniqueWorkplaceId)) {
      uniqueWorkplaceId = `${workplaceId}-${suffix}`;
      suffix += 1;
    }
    usedWorkplaceIds.add(uniqueWorkplaceId);

    desks.push({
      id: normalizeEntityId(wp.id, `imported-${uniqueWorkplaceId}`),
      label: String(wp.getAttribute('data-room-name') || uniqueWorkplaceId).slice(0, 40) || `WP ${idx + 1}`,
      name: normalizeEntityId(wp.getAttribute('data-room-name'), null),
      building_id: buildingId,
      storey_id: storeyId,
      zone_id: zoneId,
      workplace_id: uniqueWorkplaceId,
      component_id: component.id,
      symbol_id: component.id,
      asset_type: 'workplace',
      bookable: true,
      fixed: false,
      assigned_to: null,
      status: normalizeImportStatus(wp.getAttribute('data-status')),
      x: snapV(transform.tx + bounds.x * transform.sx),
      y: snapV(transform.ty + bounds.y * transform.sy),
      w: Math.max(1, Math.abs(bounds.w * transform.sx)),
      h: Math.max(1, Math.abs(bounds.h * transform.sy)),
      r: transform.r,
      locked: false,
    });
  });

  if (!desks.length) return null;
  return {
    svg,
    vb,
    components,
    desks,
    building_id: firstBuilding,
    storey_id: firstStorey,
    zone_id: firstZone,
    stats: {
      symbols: symbolMap.size,
      components: components.length,
      workplaces: desks.length,
    },
  };
}

function uniqueImportedDeskId(rawId, existing) {
  const base = normalizeEntityId(rawId, uid());
  if (!existing.has(base)) {
    existing.add(base);
    return base;
  }
  let idx = 2;
  while (existing.has(`${base}-${idx}`)) idx += 1;
  const out = `${base}-${idx}`;
  existing.add(out);
  return out;
}

function sanitizeBackgroundSvgClone(svg) {
  const clone = svg.cloneNode(true);
  clone.querySelectorAll('#interactive-layer, .interactive-layer, .workplace, script, foreignObject').forEach((node) => node.remove());
  clone.querySelectorAll('*').forEach((node) => {
    Array.from(node.attributes || []).forEach((attr) => {
      const name = String(attr.name || '').toLowerCase();
      const value = String(attr.value || '').toLowerCase();
      if (name.startsWith('on') || value.includes('javascript:')) node.removeAttribute(attr.name);
    });
  });
  if (!clone.getAttribute('xmlns')) clone.setAttribute('xmlns', NS);
  return clone;
}

async function uploadComponentizedImportBackground(result, file) {
  if (!result?.svg || !ed.floorId) return null;
  const clone = sanitizeBackgroundSvgClone(result.svg);
  const svgText = new XMLSerializer().serializeToString(clone);
  const baseName = String(file?.name || 'componentized-layout').replace(/\.[^.]+$/, '').replace(/[^\w.-]+/g, '-').slice(0, 80) || 'componentized-layout';
  const blob = new Blob([svgText], { type: 'image/svg+xml' });
  const fd = new FormData();
  fd.append('file', blob, `${baseName}-background.svg`);
  const resp = await fetch(`${API}/floors/${ed.floorId}/plan`, {
    method: 'POST',
    headers: ah(),
    body: fd,
  });
  if (!resp.ok) {
    const body = await resp.json().catch(() => ({}));
    throw new Error(body.detail || `background upload failed: ${resp.status}`);
  }
  return resp.json();
}

async function applyComponentizedLayoutImport(result, file) {
  if (!result || !ld) return false;
  const hadGeometry = _layoutHasGeometry(ld);
  const existingIds = new Set((ld.desks || []).map((desk) => desk.id));
  const importedDesks = result.desks.map((desk) => ({
    ...desk,
    id: uniqueImportedDeskId(desk.id, existingIds),
  }));

  ld.components = normalizeLayoutComponents([...(ld.components || []), ...result.components]);
  if (!Array.isArray(ld.desks)) ld.desks = [];
  ld.desks.push(...importedDesks);
  if (!hadGeometry && Array.isArray(result.vb)) {
    ld.vb = result.vb.slice();
  }
  if (!ld.building_id && result.building_id) ld.building_id = result.building_id;
  if (!ld.storey_id && result.storey_id) ld.storey_id = result.storey_id;
  if (!ld.zone_id && result.zone_id) ld.zone_id = result.zone_id;

  try {
    const floor = await uploadComponentizedImportBackground(result, file);
    if (floor?.plan_url) {
      ld.bg_url = floor.plan_url;
      const [x, y, w, h] = result.vb;
      ld.bg_transform = { x, y, w, h };
    }
  } catch (ex) {
    edToast(`Компоненты импортированы, но фон не загружен: ${ex.message}`, 'error');
  }

  ensureLayoutArrays(ld);
  markDirty();
  closeImportModal();
  if (!hadGeometry) fitToScreen();
  renderAll();
  edToast(
    `Импортировано как компоненты: ${result.stats.workplaces} workplace, ${result.stats.components} symbols. Линии сохранены фоном.`,
    'success',
  );
  return true;
}

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
      if (!ld) ld = ensureLayoutArrays({ v:2, vb:[0,0,1000,1000], bg_url:null, bg_transform:null, walls:[], boundaries:[], partitions:[], doors:[], desks:[] });
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

  // Componentized HTML/SVG — keep symbols/workplaces instead of flattening into lines.
  try {
    const text = await file.text();
    const componentized = buildComponentizedLayoutImport(text);
    if (componentized) {
      if (!ld) {
        ld = ensureLayoutArrays({
          v: 2,
          vb: componentized.vb,
          bg_url: null,
          bg_transform: null,
          components: [],
          walls: [],
          boundaries: [],
          partitions: [],
          doors: [],
          desks: [],
        });
      }
      await applyComponentizedLayoutImport(componentized, file);
      return;
    }
    if (!isSvg) {
      edToast('Поддерживаются PNG/SVG, либо HTML с componentized SVG и .workplace', 'error');
      return;
    }
    const source = extractSvgSourceFromText(text);
    const body = source?.svgText || text;

    // Plain SVG — send to structure classifier.
    const resp = await fetch(`${API}/floors/${ed.floorId}/layout/import`, {
      method: 'POST',
      headers: { ...ah(), 'Content-Type': 'image/svg+xml' },
      body,
    });
    if (!resp.ok) { const b = await resp.json().catch(()=>({})); edToast('SVG ошибка: '+(b.detail||resp.status),'error'); return; }
    _importResult = await resp.json();
    showImportResult(_importResult);
  } catch (ex) { edToast('Ошибка: ' + ex.message, 'error'); }
}

function showImportResult(res) {
  const statsEl = $el('ed-import-stats');
  const resultEl = $el('ed-import-result');

  if (statsEl) {
    statsEl.innerHTML = [
      { n: res.stats.walls,      l: 'Стены'       },
      { n: res.stats.boundaries, l: 'Границы'     },
      { n: res.stats.partitions, l: 'Перегородки' },
      { n: res.stats.doors || 0, l: 'Двери'       },
      { n: res.stats.uncertain,  l: 'Неопределено'},
      { n: res.stats.skipped,    l: 'Пропущено'   },
      { n: res.stats.total_elements, l: 'Всего'   },
    ].map(s =>
      `<div class="ed-stat-card"><span class="num">${s.n}</span><span class="lbl">${s.l}</span></div>`
    ).join('');
  }

  _importItems = buildImportItems(res);
  _importOverrides = {};
  _importItems.forEach((el) => {
    _importOverrides[el._idx] = importDefaultType(el);
  });
  _importApplied = new Set();
  _importSelected = new Set();
  _importReviewMode = false;
  _importFilters = { conf: 'all', type: 'all', geom: 'all' };
  _importAppliedCounts = { wall: 0, boundary: 0, partition: 0, door: 0, skip: 0 };

  if (resultEl) resultEl.classList.remove('ed-hidden');
  const confSel = $el('ed-import-filter-conf'); if (confSel) confSel.value = _importFilters.conf;
  const typeSel = $el('ed-import-filter-type'); if (typeSel) typeSel.value = _importFilters.type;
  const geomSel = $el('ed-import-filter-geom'); if (geomSel) geomSel.value = _importFilters.geom;
  bindImportListEvents();
  syncImportSummary();
  updateImportActionButtons();
  renderImportRows();
  renderImportPreview();
}

function closeImportModal() {
  $el('ed-import-overlay')?.classList.add('ed-hidden');
  resetImportState();
  const resultEl = $el('ed-import-result');
  if (resultEl) resultEl.classList.add('ed-hidden');
  ['ed-import-review', 'ed-import-apply-auto', 'ed-import-apply-review'].forEach((id) => {
    const btn = $el(id);
    if (btn) btn.classList.add('ed-hidden');
  });
  $el('ed-import-review-controls')?.classList.add('ed-hidden');
  const itemsEl = $el('ed-import-items');
  if (itemsEl) itemsEl.innerHTML = '';
  const summaryEl = $el('ed-import-summary');
  if (summaryEl) summaryEl.textContent = '';
  renderImportPreview();
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
    ld = ensureLayoutArrays(data.layout);
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
  const downloadSvgBtn = $el('ed-download-svg-btn');
  const downloadHtmlBtn = $el('ed-download-html-btn');
  const discBtn = $el('ed-discard-btn');
  const bgAdjustBtn = $el('ed-bg-adjust-btn');
  const clearBgBtn = $el('ed-clear-bg-btn');

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
  if (downloadSvgBtn) downloadSvgBtn.disabled = !hasFloor;
  if (downloadHtmlBtn) downloadHtmlBtn.disabled = !hasFloor;
  if (discBtn) discBtn.disabled = !hasFloor || ed.status !== 'draft';
  if (bgAdjustBtn) bgAdjustBtn.disabled = !hasFloor || !ld?.bg_url;
  if (clearBgBtn) clearBgBtn.disabled = !hasFloor || !ld?.bg_url;
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
      if (!ed.shiftDown) ed.shiftDown = true;
      if (!isDrawMode(ed.mode) && !ed.shiftFine) {
        ed.shiftFine = true;
        if (isDeskBlockMode() && ed.deskTool.preview) {
          rebuildDeskBlockPreview(ed.deskTool.preview.current || ed.deskTool.preview.anchor);
        }
      }
      updateStatusBar();
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
      case 'o': case 'O': setMode('door');      break;
      case 'd': case 'D': setMode('desk');      break;
      case 'c': case 'C': setMode('component'); break;
      case 'f': case 'F': fitToScreen();         break;
      case 'q': case 'Q':
        if (rotateDeskSelectionBy(e.shiftKey ? -1 : -5)) e.preventDefault();
        break;
      case 'e': case 'E':
        if (rotateDeskSelectionBy(e.shiftKey ? 1 : 5)) e.preventDefault();
        break;
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
        if (!$el('ed-import-overlay')?.classList.contains('ed-hidden')) {
          closeImportModal();
          break;
        }
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
        if (hasMultiDeskSelection() && hasMultiStructSelection()) {
          deleteSelectedMultiObjects();
          break;
        }
        if (hasMultiDeskSelection()) {
          deleteSelectedDesks();
          break;
        }
        if (hasMultiStructSelection()) {
          deleteSelectedStructures();
          break;
        }
        if (ed.selType === 'desk') {
          deleteSelectedDesks();
          break;
        }
        if (isStructType(ed.selType)) {
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
      ed.shiftDown = false;
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
    if (!ed.altSnapOff && !ed.shiftFine && !ed.shiftDown) return;
    ed.altSnapOff = false;
    ed.shiftFine = false;
    ed.shiftDown = false;
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

function syncFloorSelects() {
  const value = ed.floorId ? String(ed.floorId) : '';
  const editorSelect = $el('ed-floor-select');
  if (editorSelect && editorSelect.value !== value) editorSelect.value = value;
}

function switchAdminTab(tabName) {
  const btn = document.querySelector(`.nav-item[data-tab="${tabName}"]`);
  if (btn) btn.click();
}

function selectedStructRecords() {
  if (!ld) return [];
  const keys = new Set(ed.multiStructKeys || []);
  if (isStructType(ed.selType) && ed.selId) keys.add(structSelKey(ed.selType, ed.selId));
  const out = [];
  keys.forEach((key) => {
    const parsed = parseStructSelKey(key);
    if (!parsed) return;
    const item = getStructByTypeId(parsed.type, parsed.id);
    if (item) out.push({ type: parsed.type, item });
  });
  return out;
}

function svgNum(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return '0';
  if (Math.abs(n - Math.round(n)) < 1e-6) return String(Math.round(n));
  return n.toFixed(4).replace(/0+$/g, '').replace(/\.$/, '');
}

function componentCandidateId(label) {
  const baseId = slugifyComponentId(label || 'custom-component');
  const existing = new Set((ld?.components || []).map((component) => component.id));
  let candidate = baseId;
  let idx = 2;
  while (existing.has(candidate) || BUILTIN_COMPONENT_IDS.has(candidate)) {
    candidate = `${baseId}-${idx}`;
    idx += 1;
  }
  return candidate;
}

function initDeskBulkControls() {
  initComponentLibrary();

  const apply = () => {
    const nextPlaceMode = $el('ed-desk-place-mode')?.value === 'block' ? 'block' : 'single';
    const wasBlock = ed.deskTool.placeMode === 'block';
    const baseSize = baseDeskSize();
    const maxW = Math.max(120, baseSize.w * 8);
    const maxH = Math.max(90, baseSize.h * 8);

    ed.deskTool.placeMode = nextPlaceMode;
    ed.deskTool.pattern = $el('ed-desk-block-pattern')?.value === 'double' ? 'double' : 'rows';
    ed.deskTool.axis = $el('ed-desk-block-axis')?.value === 'vertical' ? 'vertical' : 'horizontal';
    const preset = $el('ed-desk-size-preset')?.value || ed.deskTool.sizePreset || 'normal';
    ed.deskTool.sizePreset = DESK_SIZE_PRESETS[preset] ? preset : 'normal';
    ed.deskTool.deskW = clampNum($el('ed-desk-width')?.value, 4, maxW, ed.deskTool.deskW ?? baseSize.w);
    ed.deskTool.deskH = clampNum($el('ed-desk-height')?.value, 4, maxH, ed.deskTool.deskH ?? baseSize.h);
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

  $el('ed-desk-size-preset')?.addEventListener('change', () => {
    setDeskSizePreset($el('ed-desk-size-preset')?.value || 'normal');
    syncDeskBulkControls();
    updateStatusBar();
    renderDrawing();
  });

  ['ed-desk-place-mode', 'ed-desk-block-pattern', 'ed-desk-block-axis', 'ed-desk-width', 'ed-desk-height', 'ed-desk-seats-per-row', 'ed-desk-row-count', 'ed-desk-pair-count']
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
  $el('ed-open-components-tab-btn')?.addEventListener('click', () => {
    const componentId = ed?.componentTool?.componentId || $el('ed-component-place-select')?.value;
    switchAdminTab('components');
    if (componentId && typeof loadComponentIntoEditor === 'function') {
      loadComponentIntoEditor(componentId);
      if (typeof selectComponentForPlacement === 'function') selectComponentForPlacement(componentId, { toast: false });
    }
  });
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
  $el('ed-download-svg-btn')?.addEventListener('click', edDownloadSemanticSvg);
  $el('ed-download-html-btn')?.addEventListener('click', edDownloadSemanticHtml);
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
  $el('ed-import-apply-auto')?.addEventListener('click', applyImportAuto);
  $el('ed-import-review')?.addEventListener('click', openImportReview);
  $el('ed-import-apply-review')?.addEventListener('click', applyImportReview);
  $el('ed-import-filter-conf')?.addEventListener('change', (e) => setImportFilter('conf', e.target.value));
  $el('ed-import-filter-type')?.addEventListener('change', (e) => setImportFilter('type', e.target.value));
  $el('ed-import-filter-geom')?.addEventListener('change', (e) => setImportFilter('geom', e.target.value));
  $el('ed-import-select-visible')?.addEventListener('click', selectVisibleImportRows);
  $el('ed-import-clear-selection')?.addEventListener('click', clearImportSelection);
  $el('ed-import-bulk-wall')?.addEventListener('click', () => bulkAssignImportType('wall'));
  $el('ed-import-bulk-boundary')?.addEventListener('click', () => bulkAssignImportType('boundary'));
  $el('ed-import-bulk-partition')?.addEventListener('click', () => bulkAssignImportType('partition'));
  $el('ed-import-bulk-door')?.addEventListener('click', () => bulkAssignImportType('door'));
  $el('ed-import-bulk-skip')?.addEventListener('click', () => bulkAssignImportType('skip'));
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

  // Warn user before closing tab if draft changes are not saved.
  window.addEventListener('beforeunload', (e) => {
    if (!ed?.dirty) return;
    e.preventDefault();
    e.returnValue = '';
  });
  // Release lock only when page is actually being hidden/unloaded.
  window.addEventListener('pagehide', releaseLockOnExit);

  initPropsListeners();
  initDeskBulkControls();
  initEditorKeyboard();
  initCollapsePanels();
  updateEditorUI();
  updateStatusBar();
  updateEditorKpis();
  syncInventoryFilters();
  syncComponentPlaceControls();
  updateLockUI();
}
