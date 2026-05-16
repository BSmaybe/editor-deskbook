/**
 * Component Library — global SVG component catalog, wizard, and CRUD.
 * Components are stored globally (API /components), not per-floor.
 * Depends on globals from editor.js (ld, ed, $el, etc.).
 */

'use strict';

let _globalComponents = [];
let _editingComponentId = null;

async function loadGlobalComponents() {
  try {
    const res = await fetch(API + '/components', { headers: ah() });
    if (!res.ok) throw new Error(res.statusText);
    const data = await res.json();
    _globalComponents = (data || []).map((c) => ({
      id: c.id,
      label: c.label,
      asset_type: c.asset_type || 'asset',
      source: 'custom',
      view_box: Array.isArray(c.view_box) ? c.view_box : [0, 0, 100, 60],
      default_w: c.default_w || 100,
      default_h: c.default_h || 60,
      svg_markup: c.svg_markup || '',
    }));
  } catch (_) {
    _globalComponents = [];
  }
  renderComponentLibrary();
}

function savedComponentFromPayload(payload) {
  return normalizeComponentRecord({
    ...payload,
    source: 'custom',
  });
}

function getGlobalComponents() {
  return _globalComponents;
}


function componentUsageCount(componentId) {
  return (ld?.desks || []).filter((item) => (item.component_id || item.symbol_id) === componentId).length;
}

function selectComponentForPlacement(componentId, opts = {}) {
  const component = componentForId(componentId, 'chair');
  if (!component) return;
  if (!ed.componentTool) ed.componentTool = { componentId: 'chair', objectW: null, objectH: null };
  ed.componentTool.componentId = component.id;
  ed.componentTool.objectW = Number(component.default_w || component.defaultW || ed.componentTool.objectW || 100);
  ed.componentTool.objectH = Number(component.default_h || component.defaultH || ed.componentTool.objectH || 60);
  if (ed.deskTool.preview) rebuildDeskBlockPreview(ed.deskTool.preview.current || ed.deskTool.preview.anchor);
  syncComponentPalette();
  if (typeof syncComponentPlaceControls === 'function') syncComponentPlaceControls();
  renderDrawing();
  if (opts.toast !== false) edToast(`Выбран компонент: ${component.label}`, 'info');
}

function componentPreviewMarkup(component) {
  if (!component) return '<div class="ed-component-preview">Компонент не выбран</div>';
  if (component.source === 'custom' && component.svg_markup && isSafeSvgMarkup(component.svg_markup)) {
    const vb = Array.isArray(component.view_box) ? component.view_box.join(' ') : '0 0 100 60';
    return `<div class="ed-component-preview"><svg viewBox="${escapeHtml(vb)}" width="220" height="150" aria-label="${escapeHtml(component.label)}">${component.svg_markup}</svg></div>`;
  }
  return `<div class="ed-component-preview">Preview: ${escapeHtml(component.label)}</div>`;
}

function renderComponentLibraryInto(list, details) {
  if (!list || !details) return;
  const catalog = componentCatalog();
  if (!catalog.length) {
    list.innerHTML = '<div class="ed-component-empty">Нет доступных компонентов.</div>';
    details.innerHTML = '';
    return;
  }
  const current = componentForId(ed?.componentTool?.componentId || 'chair', 'chair') || catalog[0];
  list.innerHTML = catalog.map((component) => {
    const used = componentUsageCount(component.id);
    const active = component.id === current.id ? ' active' : '';
    const sourceClass = component.source === 'custom' ? ' custom' : '';
    return `<button class="ed-component-row${active}" type="button" data-component-pick="${escapeHtml(component.id)}">
      <span>
        <span class="ed-component-row-title">${escapeHtml(component.label)}</span>
        <span class="ed-component-row-id">${escapeHtml(component.id)}</span>
      </span>
      <span class="ed-component-row-meta">
        <span class="ed-component-chip${sourceClass}">${escapeHtml(component.source || 'system')}</span>
        <span class="ed-component-row-id">${escapeHtml(component.asset_type || 'asset')}${ld ? ` · ${used}x` : ''}</span>
      </span>
    </button>`;
  }).join('');
  list.querySelectorAll('[data-component-pick]').forEach((btn) => {
    btn.addEventListener('click', () => {
      selectComponentForPlacement(btn.dataset.componentPick);
      if (list.id === 'component-page-list' && typeof loadComponentIntoEditor === 'function') {
        loadComponentIntoEditor(btn.dataset.componentPick);
      }
    });
  });

  const used = componentUsageCount(current.id);
  const viewBox = Array.isArray(current.view_box) ? current.view_box.map((n) => svgNum(n)).join(' ') : '0 0 100 60';
  details.innerHTML = `<div class="ed-component-detail">
    <h4>${escapeHtml(current.label)}</h4>
    <div class="ed-component-row-id">${escapeHtml(current.id)}</div>
    <div class="ed-component-detail-grid">
      <div class="ed-component-detail-card"><span>Тип</span><strong>${escapeHtml(current.asset_type || 'asset')}</strong></div>
      <div class="ed-component-detail-card"><span>Источник</span><strong>${escapeHtml(current.source || 'system')}</strong></div>
      <div class="ed-component-detail-card"><span>ViewBox</span><strong>${escapeHtml(viewBox)}</strong></div>
      ${ld ? `<div class="ed-component-detail-card"><span>На карте</span><strong>${used}</strong></div>` : ''}
    </div>
    ${componentPreviewMarkup(current)}
  </div>`;
}

function renderComponentLibrary() {
  renderComponentLibraryInto($el('component-page-list'), $el('component-page-details'));
  const deletePageBtn = $el('component-delete-page-btn');
  const current = componentForId(ed?.componentTool?.componentId || 'chair', 'chair');
  if (deletePageBtn && current) {
    const used = componentUsageCount(current.id);
    deletePageBtn.disabled = current.source !== 'custom' || used > 0;
    deletePageBtn.title = current.source !== 'custom'
      ? 'Системные компоненты нельзя удалить'
      : used > 0
        ? 'Компонент используется на карте'
        : 'Удалить custom-компонент';
  }
}


async function deleteSelectedCustomComponent() {
  const id = safeComponentId($el('ed-component-place-select')?.value || ed.componentTool?.componentId);
  if (!id) return;
  if (BUILTIN_COMPONENT_IDS.has(id)) {
    edToast('Системные компоненты нельзя удалить', 'info');
    return;
  }
  const component = _globalComponents.find((c) => c.id === id);
  if (!component) {
    edToast('Custom-компонент не найден', 'error');
    return;
  }
  if (ld && (ld.desks || []).some((item) => (item.component_id || item.symbol_id) === id)) {
    edToast('Нельзя удалить компонент: он используется на текущей карте', 'error');
    return;
  }
  if (!confirm(`Удалить компонент "${component.label}"?`)) return;
  try {
    const res = await fetch(API + '/components/' + encodeURIComponent(id), {
      method: 'DELETE',
      headers: ah(),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.detail || res.statusText);
    }
  } catch (e) {
    edToast(`Ошибка удаления: ${e.message}`, 'error');
    return;
  }
  await loadGlobalComponents();
  resetCompEditor();
  if (ed.componentTool) {
    ed.componentTool.componentId = 'chair';
    ed.componentTool.objectW = null;
    ed.componentTool.objectH = null;
  }
  if (typeof syncComponentPalette === 'function') syncComponentPalette();
  if (typeof syncComponentPlaceControls === 'function') syncComponentPlaceControls();
  renderComponentLibrary();
  edToast('Компонент удалён', 'success');
}

function initComponentLibrary() {
  $el('ed-component-place-select')?.addEventListener('change', () => {
    selectComponentForPlacement($el('ed-component-place-select')?.value, { toast: false });
  });
  $el('component-delete-page-btn')?.addEventListener('click', () => deleteSelectedCustomComponent());
  loadGlobalComponents();
  initCompEditor();
}

function setCompEditState(componentId, opts = {}) {
  _editingComponentId = componentId || null;
  const idEl = $el('comp-edit-id');
  const saveBtn = $el('comp-save-btn');
  const hint = $el('comp-edit-mode-hint');
  if (idEl) idEl.readOnly = !!_editingComponentId;
  if (saveBtn) saveBtn.textContent = _editingComponentId ? 'Сохранить изменения' : 'Создать компонент';
  if (hint) {
    hint.textContent = _editingComponentId
      ? 'Редактируется custom-компонент. Component ID зафиксирован, чтобы не сломать уже размещённые объекты.'
      : (opts.hint || 'Создается новый custom-компонент. Системные компоненты можно использовать как шаблон-копию.');
  }
}

function builtinComponentMarkup(component) {
  const vb = Array.isArray(component?.view_box) ? component.view_box : [0, 0, 100, 60];
  const w = Math.max(1, Number(vb[2] || component?.default_w || 100));
  const h = Math.max(1, Number(vb[3] || component?.default_h || 60));
  const rect = (x, y, rw, rh, rx, fill = '#dbeafe', stroke = '#2563eb') =>
    `<rect x="${svgNum(x)}" y="${svgNum(y)}" width="${svgNum(rw)}" height="${svgNum(rh)}" rx="${svgNum(rx)}" fill="${fill}" stroke="${stroke}" stroke-width="1.5"/>`;
  const chair = (x, y, cw, ch) => [
    rect(x + cw * 0.12, y + ch * 0.06, cw * 0.76, ch * 0.30, Math.min(cw, ch) * 0.08, '#bfdbfe'),
    rect(x + cw * 0.10, y + ch * 0.38, cw * 0.80, ch * 0.50, Math.min(cw, ch) * 0.10, '#60a5fa'),
  ].join('\n');
  const meeting = (x, y, mw, mh) => {
    const circles = [[0.18, 0.12], [0.5, 0.08], [0.82, 0.12], [0.18, 0.88], [0.5, 0.92], [0.82, 0.88]]
      .map(([px, py]) => `<ellipse cx="${svgNum(x + mw * px)}" cy="${svgNum(y + mh * py)}" rx="${svgNum(Math.max(2, mw * 0.045))}" ry="${svgNum(Math.max(2, mh * 0.055))}" fill="#e0f2fe" stroke="#0f766e" stroke-width="1.2"/>`)
      .join('\n');
    return `${rect(x + mw * 0.12, y + mh * 0.20, mw * 0.76, mh * 0.60, Math.min(mw, mh) * 0.12, '#ccfbf1', '#0f766e')}\n${circles}`;
  };

  switch (component?.id) {
    case 'workplace-desk-chair':
      return `${rect(0, 0, w, h * 0.56, Math.min(w, h) * 0.06)}\n${chair(w * 0.32, h * 0.64, w * 0.36, h * 0.32)}`;
    case 'chair':
    case 'conference-chair':
      return chair(0, 0, w, h);
    case 'desk-long':
      return `${rect(0, 0, w, h, Math.min(w, h) * 0.06, '#fef3c7', '#d97706')}\n<line x1="${svgNum(w / 2)}" y1="${svgNum(h * 0.15)}" x2="${svgNum(w / 2)}" y2="${svgNum(h * 0.85)}" stroke="#d97706" stroke-width="1.2"/>`;
    case 'meeting-table':
      return meeting(0, 0, w, h);
    case 'conference-set':
      return `${meeting(w * 0.18, h * 0.22, w * 0.64, h * 0.56)}\n${chair(w * 0.42, 0, w * 0.16, h * 0.22)}\n${chair(w * 0.42, h * 0.78, w * 0.16, h * 0.22)}\n${chair(0, h * 0.38, w * 0.18, h * 0.24)}\n${chair(w * 0.82, h * 0.38, w * 0.18, h * 0.24)}`;
    case 'desk-short':
    default:
      return rect(0, 0, w, h, Math.min(w, h) * 0.06, '#fef3c7', '#d97706');
  }
}

function componentEditorCandidateId(label) {
  const baseId = slugifyComponentId(label || 'custom-component');
  const existing = new Set([
    ..._globalComponents.map((component) => component.id),
    ...(ld?.components || []).map((component) => component.id),
    ...BUILTIN_COMPONENT_IDS,
  ]);
  let candidate = baseId;
  let idx = 2;
  while (existing.has(candidate)) {
    candidate = `${baseId}-${idx}`;
    idx += 1;
  }
  return candidate;
}

/* ══════════════════════════════════════════════════════════════════════════
   Component Editor — visual SVG drawing canvas + code editor
   ══════════════════════════════════════════════════════════════════════════ */

const _ce = {
  mode: 'draw',
  tool: 'select',
  shapes: [],
  selectedIdx: -1,
  drawing: false,
  dragStart: null,
  dragOffset: null,
  resizing: false,
  resizeHandle: null,
  fillColor: '#dbeafe',
  strokeColor: '#2563eb',
  strokeWidth: 1.5,
  borderRadius: 2,
  nextId: 1,
};

function resetCompEditor() {
  setCompEditState(null);
  _ce.shapes = [];
  _ce.selectedIdx = -1;
  _ce.nextId = 1;
  renderCompCanvas();
  const code = $el('comp-svg-code');
  if (code) code.value = '';
  updateCompCodePreview();
  const name = $el('comp-edit-name');
  if (name) name.value = '';
  const idEl = $el('comp-edit-id');
  if (idEl) { idEl.value = ''; idEl.dataset.touched = ''; }
  const typeEl = $el('comp-edit-type');
  if (typeEl) typeEl.value = 'asset';
  const wEl = $el('comp-edit-w');
  if (wEl) { wEl.value = '100'; wEl.dataset.touched = ''; }
  const hEl = $el('comp-edit-h');
  if (hEl) { hEl.value = '60'; hEl.dataset.touched = ''; }
  switchCompMode('draw');
}

function initCompEditor() {
  setCompEditState(null);
  // New component button
  $el('component-create-page-btn')?.addEventListener('click', () => {
    resetCompEditor();
    $el('comp-edit-name')?.focus();
  });

  // Mode tabs
  document.querySelectorAll('.comp-tab[data-comp-mode]').forEach(btn => {
    btn.addEventListener('click', () => switchCompMode(btn.dataset.compMode));
  });

  // Tool buttons
  document.querySelectorAll('.comp-tool-btn[data-tool]').forEach(btn => {
    btn.addEventListener('click', () => setCompTool(btn.dataset.tool));
  });

  // Color pickers
  const fillInput = $el('comp-fill-color');
  const strokeInput = $el('comp-stroke-color');
  if (fillInput) {
    fillInput.addEventListener('input', () => {
      _ce.fillColor = fillInput.value;
      $el('comp-fill-swatch').style.background = fillInput.value;
      applyPropsToSelected();
    });
    $el('comp-fill-swatch')?.addEventListener('click', () => fillInput.click());
  }
  if (strokeInput) {
    strokeInput.addEventListener('input', () => {
      _ce.strokeColor = strokeInput.value;
      $el('comp-stroke-swatch').style.background = strokeInput.value;
      applyPropsToSelected();
    });
    $el('comp-stroke-swatch')?.addEventListener('click', () => strokeInput.click());
  }

  // Stroke width & border radius
  $el('comp-stroke-width')?.addEventListener('input', () => {
    _ce.strokeWidth = parseFloat($el('comp-stroke-width').value) || 1.5;
    applyPropsToSelected();
  });
  $el('comp-border-radius')?.addEventListener('input', () => {
    _ce.borderRadius = parseFloat($el('comp-border-radius').value) || 0;
    applyPropsToSelected();
  });

  // Delete button
  $el('comp-delete-shape')?.addEventListener('click', deleteCompSelected);

  // Canvas events
  const svg = $el('comp-canvas');
  if (svg) {
    svg.addEventListener('pointerdown', onCompPointerDown);
    svg.addEventListener('pointermove', onCompPointerMove);
    svg.addEventListener('pointerup', onCompPointerUp);
  }

  // Keyboard
  document.addEventListener('keydown', onCompKeyDown);

  // Code editor live preview
  $el('comp-svg-code')?.addEventListener('input', updateCompCodePreview);

  // Save button
  $el('comp-save-btn')?.addEventListener('click', saveCompComponent);
  ['comp-shape-x', 'comp-shape-y', 'comp-shape-w', 'comp-shape-h', 'comp-shape-rx',
   'comp-line-x1', 'comp-line-y1', 'comp-line-x2', 'comp-line-y2']
    .forEach(id => {
      $el(id)?.addEventListener('input', applyShapePropsFromPanel);
      $el(id)?.addEventListener('change', applyShapePropsFromPanel);
    });

  // Name → auto-ID
  $el('comp-edit-name')?.addEventListener('input', () => {
    const idEl = $el('comp-edit-id');
    if (!idEl || idEl.dataset.touched === '1') return;
    idEl.value = slugifyComponentId($el('comp-edit-name')?.value || 'custom-component');
  });
  $el('comp-edit-id')?.addEventListener('input', () => {
    const idEl = $el('comp-edit-id');
    if (idEl) idEl.dataset.touched = '1';
  });
  $el('comp-edit-w')?.addEventListener('input', () => {
    const el = $el('comp-edit-w');
    if (el) el.dataset.touched = '1';
  });
  $el('comp-edit-h')?.addEventListener('input', () => {
    const el = $el('comp-edit-h');
    if (el) el.dataset.touched = '1';
  });
}

/* ── Mode switching ─────────────────────────────────────────────────────── */

function switchCompMode(mode, opts = {}) {
  _ce.mode = mode === 'code' ? 'code' : 'draw';
  document.querySelectorAll('.comp-tab[data-comp-mode]').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.compMode === _ce.mode);
  });
  const drawPanel = $el('comp-draw-mode');
  const codePanel = $el('comp-code-mode');
  if (drawPanel) drawPanel.style.display = _ce.mode === 'draw' ? '' : 'none';
  if (codePanel) codePanel.style.display = _ce.mode === 'code' ? '' : 'none';

  if (_ce.mode === 'code') {
    // Sync shapes → SVG code
    if (!opts.keepCode) $el('comp-svg-code').value = shapesToSvgMarkup();
    updateCompCodePreview();
  } else {
    // Sync code → shapes (try to parse)
    const code = ($el('comp-svg-code')?.value || '').trim();
    if (code && !opts.keepShapes) {
      const parsed = svgMarkupToShapes(code);
      if (parsed.length) {
        _ce.shapes = parsed;
        _ce.nextId = parsed.reduce((m, s) => Math.max(m, s.id + 1), 1);
      }
    }
    _ce.selectedIdx = -1;
    renderCompCanvas();
  }
}

/* ── Tool selection ─────────────────────────────────────────────────────── */

function setCompTool(tool) {
  _ce.tool = tool;
  _ce.selectedIdx = -1;
  document.querySelectorAll('.comp-tool-btn[data-tool]').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.tool === tool);
  });
  const wrap = document.querySelector('.comp-canvas-wrap');
  if (wrap) wrap.style.cursor = tool === 'select' ? 'default' : 'crosshair';
  renderCompCanvas();
}

/* ── Canvas rendering ───────────────────────────────────────────────────── */

function renderCompCanvas(opts = {}) {
  const g = $el('comp-shapes');
  if (!g) return;
  g.innerHTML = _ce.shapes.map((s, i) => shapeToSvg(s, i === _ce.selectedIdx, i)).join('');
  if (!opts.skipShapePropsSync) syncShapePropsPanel();
  if (!opts.skipSizeSync) syncDefaultSizeFromShapes();
}

function shapeToSvg(s, selected, idx = -1) {
  const sel = selected ? ' class="comp-shape-selected"' : '';
  const sw = s.strokeWidth ?? 1.5;
  const shapeIdx = idx >= 0 ? ` data-shape-idx="${idx}"` : '';
  const common = `fill="${s.fill || 'none'}" stroke="${s.stroke || '#64748b'}" stroke-width="${sw}"${shapeIdx}`;
  let svg = '';
  if (s.type === 'rect') {
    svg = `<rect x="${s.x}" y="${s.y}" width="${s.w}" height="${s.h}" rx="${s.rx || 0}" ${common}${sel}/>`;
  } else if (s.type === 'ellipse') {
    const cx = s.x + s.w / 2, cy = s.y + s.h / 2;
    svg = `<ellipse cx="${cx}" cy="${cy}" rx="${s.w / 2}" ry="${s.h / 2}" ${common}${sel}/>`;
  } else if (s.type === 'line') {
    svg = `<line x1="${s.x1}" y1="${s.y1}" x2="${s.x2}" y2="${s.y2}" ${common} stroke-linecap="round"${sel}/>`;
  }
  if (selected && s.type === 'line') {
    svg += [
      [s.x1, s.y1, 0],
      [s.x2, s.y2, 1],
    ].map(([hx, hy, hi]) =>
      `<circle cx="${hx}" cy="${hy}" r="4" fill="#fff" stroke="#1476d6" stroke-width="1.5" data-handle="${hi}" style="cursor:crosshair"/>`
    ).join('');
  } else if (selected && s.type !== 'line') {
    const hSize = 6;
    const handles = [
      [s.x, s.y], [s.x + s.w, s.y],
      [s.x, s.y + s.h], [s.x + s.w, s.y + s.h],
    ];
    svg += handles.map(([hx, hy], hi) =>
      `<rect x="${hx - hSize / 2}" y="${hy - hSize / 2}" width="${hSize}" height="${hSize}" fill="#fff" stroke="${'#1476d6'}" stroke-width="1.5" data-handle="${hi}" style="cursor:nwse-resize"/>`
    ).join('');
  }
  return svg;
}

/* ── Canvas pointer events ──────────────────────────────────────────────── */

function compSvgPoint(e) {
  const svg = $el('comp-canvas');
  const pt = svg.createSVGPoint();
  pt.x = e.clientX;
  pt.y = e.clientY;
  const ctm = svg.getScreenCTM().inverse();
  const svgPt = pt.matrixTransform(ctm);
  return { x: Math.round(svgPt.x * 10) / 10, y: Math.round(svgPt.y * 10) / 10 };
}

function onCompPointerDown(e) {
  if (_ce.mode !== 'draw') return;
  e.preventDefault();
  const pt = compSvgPoint(e);
  const svg = $el('comp-canvas');

  // Check resize handles first
  if (_ce.selectedIdx >= 0) {
    const handleEl = e.target.closest('[data-handle]');
    if (handleEl) {
      _ce.resizing = true;
      _ce.resizeHandle = parseInt(handleEl.dataset.handle);
      _ce.dragStart = pt;
      svg.setPointerCapture(e.pointerId);
      return;
    }
  }

  if (_ce.tool === 'select') {
    const shapeEl = e.target.closest('[data-shape-idx]');
    const idx = shapeEl ? parseInt(shapeEl.dataset.shapeIdx, 10) : hitTestShapes(pt);
    _ce.selectedIdx = idx;
    if (idx >= 0) {
      const s = _ce.shapes[idx];
      _ce.drawing = false;
      _ce.dragStart = pt;
      if (s.type === 'line') {
        _ce.dragOffset = { x: pt.x - s.x1, y: pt.y - s.y1 };
      } else {
        _ce.dragOffset = { x: pt.x - s.x, y: pt.y - s.y };
      }
      svg.setPointerCapture(e.pointerId);
      loadSelectedToToolbar();
    }
    renderCompCanvas();
    return;
  }

  // Drawing a new shape
  _ce.drawing = true;
  _ce.dragStart = pt;
  _ce.selectedIdx = -1;
  svg.setPointerCapture(e.pointerId);
}

function onCompPointerMove(e) {
  if (_ce.mode !== 'draw') return;
  const pt = compSvgPoint(e);

  if (_ce.resizing && _ce.selectedIdx >= 0) {
    resizeCompShape(pt);
    renderCompCanvas();
    return;
  }

  if (_ce.tool === 'select' && _ce.dragStart && _ce.selectedIdx >= 0 && !_ce.drawing) {
    dragCompShape(pt);
    renderCompCanvas();
    return;
  }

  if (_ce.drawing && _ce.dragStart) {
    renderCompCanvasWithPreview(pt);
  }
}

function onCompPointerUp(e) {
  if (_ce.mode !== 'draw') return;
  const pt = compSvgPoint(e);

  if (_ce.resizing) {
    _ce.resizing = false;
    _ce.resizeHandle = null;
    _ce.dragStart = null;
    renderCompCanvas();
    return;
  }

  if (_ce.tool === 'select') {
    _ce.dragStart = null;
    _ce.dragOffset = null;
    return;
  }

  if (_ce.drawing && _ce.dragStart) {
    _ce.drawing = false;
    const shape = createShapeFromDrag(_ce.dragStart, pt);
    if (shape) {
      _ce.shapes.push(shape);
      _ce.selectedIdx = _ce.shapes.length - 1;
      setCompTool('select');
    }
    _ce.dragStart = null;
    renderCompCanvas();
  }
}

/* ── Shape creation ─────────────────────────────────────────────────────── */

function createShapeFromDrag(start, end) {
  const x = Math.min(start.x, end.x);
  const y = Math.min(start.y, end.y);
  const w = Math.abs(end.x - start.x);
  const h = Math.abs(end.y - start.y);

  if (_ce.tool === 'line') {
    if (Math.hypot(end.x - start.x, end.y - start.y) < 3) return null;
    return {
      id: _ce.nextId++, type: 'line',
      x1: start.x, y1: start.y, x2: end.x, y2: end.y,
      fill: 'none', stroke: _ce.strokeColor, strokeWidth: _ce.strokeWidth,
    };
  }

  if (w < 3 || h < 3) return null;
  const type = _ce.tool === 'ellipse' ? 'ellipse' : 'rect';
  return {
    id: _ce.nextId++, type,
    x, y, w, h,
    rx: (_ce.tool === 'roundrect') ? Math.min(_ce.borderRadius, w / 2, h / 2) : (_ce.tool === 'rect' ? 0 : 0),
    fill: _ce.fillColor, stroke: _ce.strokeColor, strokeWidth: _ce.strokeWidth,
  };
}

/* ── Hit testing ────────────────────────────────────────────────────────── */

function hitTestShapes(pt) {
  for (let i = _ce.shapes.length - 1; i >= 0; i--) {
    const s = _ce.shapes[i];
    if (s.type === 'line') {
      const dist = pointToLineDist(pt, s.x1, s.y1, s.x2, s.y2);
      if (dist < 6) return i;
    } else {
      if (pt.x >= s.x && pt.x <= s.x + s.w && pt.y >= s.y && pt.y <= s.y + s.h) return i;
    }
  }
  return -1;
}

function pointToLineDist(pt, x1, y1, x2, y2) {
  const A = pt.x - x1, B = pt.y - y1, C = x2 - x1, D = y2 - y1;
  const dot = A * C + B * D, lenSq = C * C + D * D;
  let t = lenSq ? Math.max(0, Math.min(1, dot / lenSq)) : 0;
  const px = x1 + t * C, py = y1 + t * D;
  return Math.hypot(pt.x - px, pt.y - py);
}

/* ── Drag & resize ──────────────────────────────────────────────────────── */

function dragCompShape(pt) {
  const s = _ce.shapes[_ce.selectedIdx];
  if (!s || !_ce.dragOffset) return;
  if (s.type === 'line') {
    const dx = pt.x - _ce.dragOffset.x - s.x1;
    const dy = pt.y - _ce.dragOffset.y - s.y1;
    s.x1 += dx; s.y1 += dy;
    s.x2 += dx; s.y2 += dy;
  } else {
    s.x = pt.x - _ce.dragOffset.x;
    s.y = pt.y - _ce.dragOffset.y;
  }
}

function resizeCompShape(pt) {
  const s = _ce.shapes[_ce.selectedIdx];
  if (!s) return;
  const h = _ce.resizeHandle;
  if (s.type === 'line') {
    if (h === 0) {
      s.x1 = pt.x;
      s.y1 = pt.y;
    } else {
      s.x2 = pt.x;
      s.y2 = pt.y;
    }
    return;
  }
  const minSize = 4;
  if (h === 0) { // top-left
    const nx = Math.min(pt.x, s.x + s.w - minSize);
    const ny = Math.min(pt.y, s.y + s.h - minSize);
    s.w += s.x - nx; s.h += s.y - ny;
    s.x = nx; s.y = ny;
  } else if (h === 1) { // top-right
    s.w = Math.max(minSize, pt.x - s.x);
    const ny = Math.min(pt.y, s.y + s.h - minSize);
    s.h += s.y - ny; s.y = ny;
  } else if (h === 2) { // bottom-left
    const nx = Math.min(pt.x, s.x + s.w - minSize);
    s.w += s.x - nx; s.x = nx;
    s.h = Math.max(minSize, pt.y - s.y);
  } else { // bottom-right
    s.w = Math.max(minSize, pt.x - s.x);
    s.h = Math.max(minSize, pt.y - s.y);
  }
}

/* ── Preview while drawing ──────────────────────────────────────────────── */

function renderCompCanvasWithPreview(pt) {
  const g = $el('comp-shapes');
  if (!g) return;
  let base = _ce.shapes.map((s, i) => shapeToSvg(s, false, i)).join('');
  const preview = createShapeFromDrag(_ce.dragStart, pt);
  if (preview) {
    const tmp = { ...preview, id: -1 };
    base += shapeToSvg(tmp, false, -1);
  }
  g.innerHTML = base;
}

/* ── Delete ──────────────────────────────────────────────────────────────── */

function deleteCompSelected() {
  if (_ce.selectedIdx < 0 || _ce.selectedIdx >= _ce.shapes.length) return;
  _ce.shapes.splice(_ce.selectedIdx, 1);
  _ce.selectedIdx = -1;
  renderCompCanvas();
}

/* ── Keyboard ───────────────────────────────────────────────────────────── */

function onCompKeyDown(e) {
  const tabComp = $el('tab-components');
  if (!tabComp || tabComp.classList.contains('hidden')) return;
  if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA' || e.target.tagName === 'SELECT') return;

  if (_ce.mode === 'draw') {
    if (e.key === 'v' || e.key === 'V') { setCompTool('select'); e.preventDefault(); }
    else if (e.key === 'r' || e.key === 'R') { setCompTool('rect'); e.preventDefault(); }
    else if (e.key === 'u' || e.key === 'U') { setCompTool('roundrect'); e.preventDefault(); }
    else if (e.key === 'o' || e.key === 'O') { setCompTool('ellipse'); e.preventDefault(); }
    else if (e.key === 'l' || e.key === 'L') { setCompTool('line'); e.preventDefault(); }
    else if ((e.key === 'Delete' || e.key === 'Backspace') && _ce.selectedIdx >= 0) {
      deleteCompSelected();
      e.preventDefault();
    }
  }
}

/* ── Load selected shape props into toolbar ─────────────────────────────── */

function loadSelectedToToolbar() {
  if (_ce.selectedIdx < 0) return;
  const s = _ce.shapes[_ce.selectedIdx];
  if (!s) return;
  if (s.fill && s.fill !== 'none') {
    _ce.fillColor = s.fill;
    const fi = $el('comp-fill-color');
    if (fi) fi.value = s.fill;
    const sw = $el('comp-fill-swatch');
    if (sw) sw.style.background = s.fill;
  }
  if (s.stroke) {
    _ce.strokeColor = s.stroke;
    const si = $el('comp-stroke-color');
    if (si) si.value = s.stroke;
    const sw = $el('comp-stroke-swatch');
    if (sw) sw.style.background = s.stroke;
  }
  if (s.strokeWidth != null) {
    _ce.strokeWidth = s.strokeWidth;
    const swi = $el('comp-stroke-width');
    if (swi) swi.value = s.strokeWidth;
  }
  if (s.rx != null) {
    _ce.borderRadius = s.rx;
    const bri = $el('comp-border-radius');
    if (bri) bri.value = s.rx;
  }
}

function applyPropsToSelected() {
  if (_ce.selectedIdx < 0) return;
  const s = _ce.shapes[_ce.selectedIdx];
  if (!s) return;
  if (s.type !== 'line') s.fill = _ce.fillColor;
  s.stroke = _ce.strokeColor;
  s.strokeWidth = _ce.strokeWidth;
  if (s.type === 'rect') s.rx = _ce.borderRadius;
  renderCompCanvas();
}

function syncShapePropsPanel() {
  const empty = $el('comp-shape-empty');
  const panel = $el('comp-shape-props');
  const title = $el('comp-shape-title');
  const shape = _ce.selectedIdx >= 0 ? _ce.shapes[_ce.selectedIdx] : null;
  if (!empty || !panel) return;
  empty.classList.toggle('ed-hidden', !!shape);
  panel.classList.toggle('ed-hidden', !shape);
  if (!shape) return;

  const isLine = shape.type === 'line';
  $el('comp-box-fields')?.classList.toggle('ed-hidden', isLine);
  $el('comp-line-fields')?.classList.toggle('ed-hidden', !isLine);
  if (title) {
    const label = shape.type === 'line' ? 'Линия' : shape.type === 'ellipse' ? 'Эллипс' : 'Прямоугольник';
    title.textContent = `${label} #${_ce.selectedIdx + 1}`;
  }

  if (isLine) {
    _v('comp-line-x1', svgNum(shape.x1));
    _v('comp-line-y1', svgNum(shape.y1));
    _v('comp-line-x2', svgNum(shape.x2));
    _v('comp-line-y2', svgNum(shape.y2));
  } else {
    _v('comp-shape-x', svgNum(shape.x));
    _v('comp-shape-y', svgNum(shape.y));
    _v('comp-shape-w', svgNum(shape.w));
    _v('comp-shape-h', svgNum(shape.h));
    _v('comp-shape-rx', svgNum(shape.type === 'rect' ? (shape.rx || 0) : 0));
    const rxInput = $el('comp-shape-rx');
    if (rxInput) rxInput.disabled = shape.type !== 'rect';
  }
}

function readEditableNumber(id, min, max, fallback, opts = {}) {
  const el = $el(id);
  const raw = String(el?.value ?? '').trim().replace(',', '.');
  const isPartial = raw === '' || raw === '-' || raw === '+' || raw === '.' || raw === '-.' || raw === '+.';
  if (isPartial) return opts.allowPartial ? null : fallback;
  const n = Number(raw);
  if (!Number.isFinite(n)) return opts.allowPartial ? null : fallback;
  return Math.max(min, Math.min(max, n));
}

function applyShapePropsFromPanel(event) {
  if (_ce.selectedIdx < 0) return;
  const shape = _ce.shapes[_ce.selectedIdx];
  if (!shape) return;
  const allowPartial = event?.type === 'input';
  if (shape.type === 'line') {
    const x1 = readEditableNumber('comp-line-x1', -100000, 100000, shape.x1, { allowPartial });
    const y1 = readEditableNumber('comp-line-y1', -100000, 100000, shape.y1, { allowPartial });
    const x2 = readEditableNumber('comp-line-x2', -100000, 100000, shape.x2, { allowPartial });
    const y2 = readEditableNumber('comp-line-y2', -100000, 100000, shape.y2, { allowPartial });
    if (x1 !== null) shape.x1 = x1;
    if (y1 !== null) shape.y1 = y1;
    if (x2 !== null) shape.x2 = x2;
    if (y2 !== null) shape.y2 = y2;
  } else {
    const x = readEditableNumber('comp-shape-x', -100000, 100000, shape.x, { allowPartial });
    const y = readEditableNumber('comp-shape-y', -100000, 100000, shape.y, { allowPartial });
    const w = readEditableNumber('comp-shape-w', 1, 100000, shape.w, { allowPartial });
    const h = readEditableNumber('comp-shape-h', 1, 100000, shape.h, { allowPartial });
    if (x !== null) shape.x = x;
    if (y !== null) shape.y = y;
    if (w !== null) shape.w = w;
    if (h !== null) shape.h = h;
    if (shape.type === 'rect') {
      const rx = readEditableNumber('comp-shape-rx', 0, Math.min(shape.w, shape.h) / 2, shape.rx || 0, { allowPartial });
      if (rx !== null) {
        shape.rx = rx;
        _ce.borderRadius = shape.rx;
        const radiusInput = $el('comp-border-radius');
        if (radiusInput) radiusInput.value = svgNum(shape.rx);
      }
    }
  }
  renderCompCanvas({ skipShapePropsSync: allowPartial });
}

/* ── Shapes ↔ SVG markup ────────────────────────────────────────────────── */

function shapesToSvgMarkup() {
  return _ce.shapes.map(s => {
    const sw = s.strokeWidth ?? 1.5;
    if (s.type === 'rect') {
      return `<rect x="${svgNum(s.x)}" y="${svgNum(s.y)}" width="${svgNum(s.w)}" height="${svgNum(s.h)}" rx="${svgNum(s.rx || 0)}" fill="${s.fill || 'none'}" stroke="${s.stroke || '#64748b'}" stroke-width="${sw}"/>`;
    } else if (s.type === 'ellipse') {
      const cx = s.x + s.w / 2, cy = s.y + s.h / 2;
      return `<ellipse cx="${svgNum(cx)}" cy="${svgNum(cy)}" rx="${svgNum(s.w / 2)}" ry="${svgNum(s.h / 2)}" fill="${s.fill || 'none'}" stroke="${s.stroke || '#64748b'}" stroke-width="${sw}"/>`;
    } else if (s.type === 'line') {
      return `<line x1="${svgNum(s.x1)}" y1="${svgNum(s.y1)}" x2="${svgNum(s.x2)}" y2="${svgNum(s.y2)}" stroke="${s.stroke || '#64748b'}" stroke-width="${sw}" stroke-linecap="round"/>`;
    }
    return '';
  }).filter(Boolean).join('\n');
}

function svgMarkupToShapes(markup) {
  const shapes = [];
  const tmp = document.createElement('div');
  tmp.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg">${markup}</svg>`;
  const svg = tmp.querySelector('svg');
  if (!svg) return shapes;
  for (const el of svg.children) {
    const tag = el.tagName.toLowerCase();
    const fill = el.getAttribute('fill') || 'none';
    const stroke = el.getAttribute('stroke') || '#64748b';
    const sw = parseFloat(el.getAttribute('stroke-width')) || 1.5;
    if (tag === 'rect') {
      shapes.push({
        id: _ce.nextId++, type: 'rect',
        x: parseFloat(el.getAttribute('x')) || 0,
        y: parseFloat(el.getAttribute('y')) || 0,
        w: parseFloat(el.getAttribute('width')) || 50,
        h: parseFloat(el.getAttribute('height')) || 30,
        rx: parseFloat(el.getAttribute('rx')) || 0,
        fill, stroke, strokeWidth: sw,
      });
    } else if (tag === 'ellipse') {
      const cx = parseFloat(el.getAttribute('cx')) || 0;
      const cy = parseFloat(el.getAttribute('cy')) || 0;
      const rx = parseFloat(el.getAttribute('rx')) || 25;
      const ry = parseFloat(el.getAttribute('ry')) || 25;
      shapes.push({
        id: _ce.nextId++, type: 'ellipse',
        x: cx - rx, y: cy - ry, w: rx * 2, h: ry * 2,
        fill, stroke, strokeWidth: sw,
      });
    } else if (tag === 'circle') {
      const cx = parseFloat(el.getAttribute('cx')) || 0;
      const cy = parseFloat(el.getAttribute('cy')) || 0;
      const r = parseFloat(el.getAttribute('r')) || 25;
      shapes.push({
        id: _ce.nextId++, type: 'ellipse',
        x: cx - r, y: cy - r, w: r * 2, h: r * 2,
        fill, stroke, strokeWidth: sw,
      });
    } else if (tag === 'line') {
      shapes.push({
        id: _ce.nextId++, type: 'line',
        x1: parseFloat(el.getAttribute('x1')) || 0,
        y1: parseFloat(el.getAttribute('y1')) || 0,
        x2: parseFloat(el.getAttribute('x2')) || 50,
        y2: parseFloat(el.getAttribute('y2')) || 50,
        fill: 'none', stroke, strokeWidth: sw,
      });
    }
  }
  return shapes;
}

/* ── Code editor preview ────────────────────────────────────────────────── */

function updateCompCodePreview() {
  const code = ($el('comp-svg-code')?.value || '').trim();
  const area = $el('comp-code-preview-area');
  if (!area) return;
  if (!code) {
    area.innerHTML = '<span style="color:#9fb3c8;font-size:12px">Введите SVG-разметку выше</span>';
    return;
  }
  if (!isSafeSvgMarkup(code)) {
    area.innerHTML = '<span style="color:#c92a2a;font-size:12px">SVG содержит небезопасные элементы</span>';
    return;
  }
  const vb = computeViewBoxFromMarkup(code);
  area.innerHTML = `<svg viewBox="${vb}" width="260" height="160" xmlns="http://www.w3.org/2000/svg" style="background:#f8fbff;border-radius:8px">${code}</svg>`;
}

function computeViewBoxFromMarkup(markup) {
  const tmp = document.createElement('div');
  tmp.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg">${markup}</svg>`;
  const svg = tmp.querySelector('svg');
  if (!svg) return '0 0 100 60';
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const el of svg.children) {
    const tag = el.tagName.toLowerCase();
    if (tag === 'rect') {
      const x = parseFloat(el.getAttribute('x')) || 0;
      const y = parseFloat(el.getAttribute('y')) || 0;
      const w = parseFloat(el.getAttribute('width')) || 0;
      const h = parseFloat(el.getAttribute('height')) || 0;
      minX = Math.min(minX, x); minY = Math.min(minY, y);
      maxX = Math.max(maxX, x + w); maxY = Math.max(maxY, y + h);
    } else if (tag === 'ellipse') {
      const cx = parseFloat(el.getAttribute('cx')) || 0;
      const cy = parseFloat(el.getAttribute('cy')) || 0;
      const rx = parseFloat(el.getAttribute('rx')) || 0;
      const ry = parseFloat(el.getAttribute('ry')) || 0;
      minX = Math.min(minX, cx - rx); minY = Math.min(minY, cy - ry);
      maxX = Math.max(maxX, cx + rx); maxY = Math.max(maxY, cy + ry);
    } else if (tag === 'circle') {
      const cx = parseFloat(el.getAttribute('cx')) || 0;
      const cy = parseFloat(el.getAttribute('cy')) || 0;
      const r = parseFloat(el.getAttribute('r')) || 0;
      minX = Math.min(minX, cx - r); minY = Math.min(minY, cy - r);
      maxX = Math.max(maxX, cx + r); maxY = Math.max(maxY, cy + r);
    } else if (tag === 'line') {
      const x1 = parseFloat(el.getAttribute('x1')) || 0;
      const y1 = parseFloat(el.getAttribute('y1')) || 0;
      const x2 = parseFloat(el.getAttribute('x2')) || 0;
      const y2 = parseFloat(el.getAttribute('y2')) || 0;
      minX = Math.min(minX, x1, x2); minY = Math.min(minY, y1, y2);
      maxX = Math.max(maxX, x1, x2); maxY = Math.max(maxY, y1, y2);
    }
  }
  if (!isFinite(minX)) return '0 0 100 60';
  const pad = 4;
  return `${svgNum(minX - pad)} ${svgNum(minY - pad)} ${svgNum(maxX - minX + pad * 2)} ${svgNum(maxY - minY + pad * 2)}`;
}

function syncDefaultSizeFromShapes() {
  const wEl = $el('comp-edit-w');
  const hEl = $el('comp-edit-h');
  if (!wEl || !hEl) return;
  if (wEl.dataset.touched === '1' || hEl.dataset.touched === '1') return;
  if (!_ce.shapes.length) return;
  const vb = computeViewBoxFromShapes();
  if (!vb) return;
  wEl.value = Math.round(vb.w);
  hEl.value = Math.round(vb.h);
}

function computeViewBoxFromShapes() {
  if (!_ce.shapes.length) return null;
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const s of _ce.shapes) {
    if (s.type === 'line') {
      minX = Math.min(minX, s.x1, s.x2);
      minY = Math.min(minY, s.y1, s.y2);
      maxX = Math.max(maxX, s.x1, s.x2);
      maxY = Math.max(maxY, s.y1, s.y2);
    } else {
      minX = Math.min(minX, s.x);
      minY = Math.min(minY, s.y);
      maxX = Math.max(maxX, s.x + s.w);
      maxY = Math.max(maxY, s.y + s.h);
    }
  }
  if (!isFinite(minX)) return null;
  const pad = 4;
  return { w: maxX - minX + pad * 2, h: maxY - minY + pad * 2 };
}

/* ── Save component ─────────────────────────────────────────────────────── */

async function saveCompComponent() {
  let svgMarkup = '';
  if (_ce.mode === 'draw') {
    svgMarkup = shapesToSvgMarkup();
  } else {
    svgMarkup = ($el('comp-svg-code')?.value || '').trim();
  }

  if (!svgMarkup) {
    edToast('Нарисуйте или введите SVG-разметку компонента', 'error');
    return;
  }

  if (!isSafeSvgMarkup(svgMarkup)) {
    edToast('SVG содержит небезопасные элементы', 'error');
    return;
  }

  const label = ($el('comp-edit-name')?.value || '').trim();
  const id = safeComponentId($el('comp-edit-id')?.value);
  const assetType = normalizeAssetType($el('comp-edit-type')?.value, null);
  const defaultW = parseFloat($el('comp-edit-w')?.value) || 100;
  const defaultH = parseFloat($el('comp-edit-h')?.value) || 60;

  if (!label) {
    edToast('Укажите название компонента', 'error');
    return;
  }
  if (!id) {
    edToast('Component ID должен начинаться с буквы/_ и содержать только A-Z, 0-9, _, ., :, -', 'error');
    return;
  }
  if (_editingComponentId && id !== _editingComponentId) {
    edToast('Component ID нельзя менять при редактировании. Создайте новый компонент, если нужен другой ID.', 'error');
    return;
  }
  if (BUILTIN_COMPONENT_IDS.has(id) || (!_editingComponentId && _globalComponents.some(c => c.id === id))) {
    edToast('Компонент с таким ID уже существует', 'error');
    return;
  }

  const viewBox = computeViewBoxFromMarkup(svgMarkup);
  const vbParts = viewBox.split(' ').map(Number);
  const vb = vbParts.length === 4 ? vbParts : [0, 0, defaultW, defaultH];
  const payload = {
    id, label, asset_type: assetType,
    view_box: vb,
    default_w: defaultW,
    default_h: defaultH,
    svg_markup: svgMarkup,
  };
  const editing = !!_editingComponentId;

  try {
    const res = await fetch(API + (editing ? '/components/' + encodeURIComponent(_editingComponentId) : '/components'), {
      method: editing ? 'PUT' : 'POST',
      headers: { ...ah(), 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.detail || res.statusText);
    }
  } catch (e) {
    edToast(`Ошибка сохранения: ${e.message}`, 'error');
    return;
  }

  await loadGlobalComponents();
  const savedComponent = savedComponentFromPayload(payload);
  const floorUsesComponent = !!ld && (
    (ld.components || []).some((component) => component.id === id) ||
    (ld.desks || []).some((item) => (item.component_id || item.symbol_id) === id)
  );
  if (floorUsesComponent && savedComponent && ensureLayoutComponent(savedComponent)) {
    markDirty();
    renderDesks();
    renderSelection();
    renderObjectList();
  }
  if (ed.componentTool) ed.componentTool.componentId = id;
  selectComponentForPlacement(id, { toast: false });
  if (editing) {
    loadComponentIntoEditor(id);
  } else {
    resetCompEditor();
    selectComponentForPlacement(id, { toast: false });
    loadComponentIntoEditor(id);
  }
  if (typeof syncComponentPalette === 'function') syncComponentPalette();
  if (typeof syncComponentPlaceControls === 'function') syncComponentPlaceControls();
  edToast(editing ? `Компонент обновлён: ${label}` : `Компонент создан: ${label}`, 'success');
}

/* ── Load existing component into editor ────────────────────────────────── */

function loadComponentIntoEditor(componentId) {
  const custom = _globalComponents.find(c => c.id === componentId);
  const system = BUILTIN_COMPONENTS.find(c => c.id === componentId);
  const comp = custom || system;
  if (!comp) return;
  const editingCustom = !!custom;
  setCompEditState(editingCustom ? comp.id : null, {
    hint: editingCustom
      ? undefined
      : 'Системный компонент открыт как шаблон. Сохранение создаст новый custom-компонент.',
  });
  $el('comp-edit-name').value = comp.label;
  const idEl = $el('comp-edit-id');
  if (idEl) {
    idEl.value = editingCustom ? comp.id : componentEditorCandidateId(`custom-${comp.id}`);
    idEl.dataset.touched = editingCustom ? '1' : '';
  }
  $el('comp-edit-type').value = comp.asset_type || 'asset';
  const wEl = $el('comp-edit-w');
  const hEl = $el('comp-edit-h');
  if (wEl) { wEl.value = comp.default_w || 100; wEl.dataset.touched = ''; }
  if (hEl) { hEl.value = comp.default_h || 60; hEl.dataset.touched = ''; }

  const markup = comp.svg_markup || builtinComponentMarkup(comp);
  const parsed = svgMarkupToShapes(markup);
  if (parsed.length) {
    _ce.shapes = parsed;
    _ce.nextId = parsed.reduce((m, s) => Math.max(m, s.id + 1), 1);
  } else {
    _ce.shapes = [];
  }
  _ce.selectedIdx = -1;
  renderCompCanvas();
  if ($el('comp-svg-code')) $el('comp-svg-code').value = markup;
  updateCompCodePreview();
  switchCompMode(parsed.length ? 'draw' : 'code', {
    keepShapes: parsed.length > 0,
    keepCode: parsed.length === 0,
  });
}
