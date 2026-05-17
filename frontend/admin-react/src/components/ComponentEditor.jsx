/**
 * ComponentEditor — visual SVG draw/code editor for the component library.
 *
 * Props:
 *   form        {id, label, asset_type, view_box, default_w, default_h, svg_markup, _isNew}
 *   busy        boolean
 *   existingIds string[]  — ids already taken (for duplicate-check)
 *   onSave      (payload) => void   — called with the final payload object
 *   onCancel    () => void
 */

import React, {
  useState,
  useRef,
  useCallback,
  useEffect,
} from 'react';
import { X, Check, MousePointer, Square, Circle, Minus, RectangleHorizontal } from 'lucide-react';
import { assetTypeLabel } from '../lib/i18n.js';
import './ComponentEditor.css';

/* ─── Constants ──────────────────────────────────────────────────────────── */

const ASSET_TYPES = [
  'workplace',
  'desk',
  'chair',
  'meeting_table',
  'conference_set',
  'call_room',
  'lounge',
  'sofa',
  'plant',
  'storage',
  'printer',
  'reception',
  'column',
  'asset',
];

const TOOLS = [
  { id: 'select',    label: 'Выбор (V)', Icon: MousePointer },
  { id: 'rect',      label: 'Прямоугольник (R)', Icon: Square },
  { id: 'roundrect', label: 'Скруглённый прямоугольник (U)', Icon: RectangleHorizontal },
  { id: 'ellipse',   label: 'Эллипс (O)', Icon: Circle },
  { id: 'line',      label: 'Линия (L)', Icon: Minus },
];

const MIN_DRAG = 3; // px — minimum size to register a draw
const HANDLE_SIZE = 6;

/* ─── Pure drawing helpers (no React) ───────────────────────────────────── */

function svgNum(n) {
  const r = Math.round(Number(n) * 10) / 10;
  return Number.isFinite(r) ? r : 0;
}

function pointToLineDist(pt, x1, y1, x2, y2) {
  const A = pt.x - x1, B = pt.y - y1, C = x2 - x1, D = y2 - y1;
  const dot = A * C + B * D;
  const lenSq = C * C + D * D;
  const t = lenSq ? Math.max(0, Math.min(1, dot / lenSq)) : 0;
  return Math.hypot(pt.x - (x1 + t * C), pt.y - (y1 + t * D));
}

function hitTestShapes(shapes, pt) {
  for (let i = shapes.length - 1; i >= 0; i--) {
    const s = shapes[i];
    if (s.type === 'line') {
      if (pointToLineDist(pt, s.x1, s.y1, s.x2, s.y2) < 6) return i;
    } else {
      if (pt.x >= s.x && pt.x <= s.x + s.w && pt.y >= s.y && pt.y <= s.y + s.h) return i;
    }
  }
  return -1;
}

function createShape(tool, start, end, fill, stroke, strokeWidth, borderRadius) {
  if (tool === 'line') {
    if (Math.hypot(end.x - start.x, end.y - start.y) < MIN_DRAG) return null;
    return { type: 'line', x1: start.x, y1: start.y, x2: end.x, y2: end.y, fill: 'none', stroke, strokeWidth };
  }
  const x = Math.min(start.x, end.x);
  const y = Math.min(start.y, end.y);
  const w = Math.abs(end.x - start.x);
  const h = Math.abs(end.y - start.y);
  if (w < MIN_DRAG || h < MIN_DRAG) return null;
  const type = tool === 'ellipse' ? 'ellipse' : 'rect';
  const rx = tool === 'roundrect' ? Math.min(borderRadius, w / 2, h / 2) : 0;
  return { type, x, y, w, h, rx, fill, stroke, strokeWidth };
}

function shapesToMarkup(shapes) {
  return shapes.map((s) => {
    const sw = s.strokeWidth ?? 1.5;
    if (s.type === 'rect') {
      return `<rect x="${svgNum(s.x)}" y="${svgNum(s.y)}" width="${svgNum(s.w)}" height="${svgNum(s.h)}" rx="${svgNum(s.rx || 0)}" fill="${s.fill || 'none'}" stroke="${s.stroke || '#64748b'}" stroke-width="${sw}"/>`;
    }
    if (s.type === 'ellipse') {
      const cx = s.x + s.w / 2, cy = s.y + s.h / 2;
      return `<ellipse cx="${svgNum(cx)}" cy="${svgNum(cy)}" rx="${svgNum(s.w / 2)}" ry="${svgNum(s.h / 2)}" fill="${s.fill || 'none'}" stroke="${s.stroke || '#64748b'}" stroke-width="${sw}"/>`;
    }
    if (s.type === 'line') {
      return `<line x1="${svgNum(s.x1)}" y1="${svgNum(s.y1)}" x2="${svgNum(s.x2)}" y2="${svgNum(s.y2)}" stroke="${s.stroke || '#64748b'}" stroke-width="${sw}" stroke-linecap="round"/>`;
    }
    return '';
  }).filter(Boolean).join('\n');
}

function markupToShapes(markup, startId = 1) {
  const shapes = [];
  let nextId = startId;
  const tmp = document.createElement('div');
  tmp.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg">${markup}</svg>`;
  const svg = tmp.querySelector('svg');
  if (!svg) return { shapes, nextId };
  for (const el of svg.children) {
    const tag = el.tagName.toLowerCase();
    const fill = el.getAttribute('fill') || 'none';
    const stroke = el.getAttribute('stroke') || '#64748b';
    const strokeWidth = parseFloat(el.getAttribute('stroke-width')) || 1.5;
    if (tag === 'rect') {
      shapes.push({ id: nextId++, type: 'rect', x: parseFloat(el.getAttribute('x')) || 0, y: parseFloat(el.getAttribute('y')) || 0, w: parseFloat(el.getAttribute('width')) || 50, h: parseFloat(el.getAttribute('height')) || 30, rx: parseFloat(el.getAttribute('rx')) || 0, fill, stroke, strokeWidth });
    } else if (tag === 'ellipse') {
      const cx = parseFloat(el.getAttribute('cx')) || 0, cy = parseFloat(el.getAttribute('cy')) || 0;
      const rx = parseFloat(el.getAttribute('rx')) || 25, ry = parseFloat(el.getAttribute('ry')) || 25;
      shapes.push({ id: nextId++, type: 'ellipse', x: cx - rx, y: cy - ry, w: rx * 2, h: ry * 2, fill, stroke, strokeWidth });
    } else if (tag === 'circle') {
      const cx = parseFloat(el.getAttribute('cx')) || 0, cy = parseFloat(el.getAttribute('cy')) || 0;
      const r = parseFloat(el.getAttribute('r')) || 25;
      shapes.push({ id: nextId++, type: 'ellipse', x: cx - r, y: cy - r, w: r * 2, h: r * 2, fill, stroke, strokeWidth });
    } else if (tag === 'line') {
      shapes.push({ id: nextId++, type: 'line', x1: parseFloat(el.getAttribute('x1')) || 0, y1: parseFloat(el.getAttribute('y1')) || 0, x2: parseFloat(el.getAttribute('x2')) || 50, y2: parseFloat(el.getAttribute('y2')) || 50, fill: 'none', stroke, strokeWidth });
    }
  }
  return { shapes, nextId };
}

function boundsFromShapes(shapes) {
  if (!shapes.length) return null;
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const s of shapes) {
    if (s.type === 'line') {
      minX = Math.min(minX, s.x1, s.x2); minY = Math.min(minY, s.y1, s.y2);
      maxX = Math.max(maxX, s.x1, s.x2); maxY = Math.max(maxY, s.y1, s.y2);
    } else {
      minX = Math.min(minX, s.x); minY = Math.min(minY, s.y);
      maxX = Math.max(maxX, s.x + s.w); maxY = Math.max(maxY, s.y + s.h);
    }
  }
  if (!isFinite(minX)) return null;
  const pad = 4;
  return { minX: minX - pad, minY: minY - pad, w: maxX - minX + pad * 2, h: maxY - minY + pad * 2 };
}

function boundsFromMarkup(markup) {
  const { shapes } = markupToShapes(markup);
  const b = boundsFromShapes(shapes);
  if (!b) return '0 0 100 60';
  return `${svgNum(b.minX)} ${svgNum(b.minY)} ${svgNum(b.w)} ${svgNum(b.h)}`;
}

function isSafeSvgMarkup(markup) {
  const UNSAFE = /(<script|javascript:|on\w+=|<iframe|<object|<embed|<link|<meta|<style|xlink:href\s*=\s*["']?\s*javascript)/i;
  return !UNSAFE.test(markup);
}

function slugify(str) {
  return str.toLowerCase().replace(/[^a-z0-9_.:−-]+/g, '-').replace(/^[^a-z_]/, '_').replace(/-+$/, '').slice(0, 120) || 'custom-component';
}

function shapeTypeLabel(type) {
  if (type === 'line') return 'Линия';
  if (type === 'ellipse') return 'Эллипс';
  return 'Прямоугольник';
}

/* ─── SVG shape renderer (pure JSX) ─────────────────────────────────────── */

function ShapeEl({ shape, selected, idx, onMouseDown }) {
  const sw = shape.strokeWidth ?? 1.5;
  const sharedProps = {
    fill: shape.fill || 'none',
    stroke: shape.stroke || '#64748b',
    strokeWidth: sw,
    'data-shape-idx': idx,
    onMouseDown,
  };

  let el = null;
  if (shape.type === 'rect') {
    el = <rect x={shape.x} y={shape.y} width={shape.w} height={shape.h} rx={shape.rx || 0} {...sharedProps} className={selected ? 'ce-shape-selected' : undefined} />;
  } else if (shape.type === 'ellipse') {
    const cx = shape.x + shape.w / 2, cy = shape.y + shape.h / 2;
    el = <ellipse cx={cx} cy={cy} rx={shape.w / 2} ry={shape.h / 2} {...sharedProps} className={selected ? 'ce-shape-selected' : undefined} />;
  } else if (shape.type === 'line') {
    el = <line x1={shape.x1} y1={shape.y1} x2={shape.x2} y2={shape.y2} {...sharedProps} strokeLinecap="round" className={selected ? 'ce-shape-selected' : undefined} />;
  }

  const handles = [];
  if (selected && shape.type === 'line') {
    [[shape.x1, shape.y1, 0], [shape.x2, shape.y2, 1]].forEach(([hx, hy, hi]) => {
      handles.push(
        <circle key={hi} cx={hx} cy={hy} r={4} fill="#fff" stroke="#1476d6" strokeWidth={1.5} data-handle={hi} style={{ cursor: 'crosshair' }} />
      );
    });
  } else if (selected) {
    [[shape.x, shape.y, 0], [shape.x + shape.w, shape.y, 1], [shape.x, shape.y + shape.h, 2], [shape.x + shape.w, shape.y + shape.h, 3]].forEach(([hx, hy, hi]) => {
      handles.push(
        <rect key={hi} x={hx - HANDLE_SIZE / 2} y={hy - HANDLE_SIZE / 2} width={HANDLE_SIZE} height={HANDLE_SIZE} fill="#fff" stroke="#1476d6" strokeWidth={1.5} data-handle={hi} style={{ cursor: 'nwse-resize' }} />
      );
    });
  }

  return <>{el}{handles}</>;
}

/* ─── Preview (draw mode) ────────────────────────────────────────────────── */

function DrawPreview({ shapes, preview, viewBox }) {
  const vb = viewBox.join(' ');
  return (
    <div className="ce-preview-box">
      <svg viewBox={vb} xmlns="http://www.w3.org/2000/svg" style={{ width: '100%', height: '100%' }}>
        {shapes.map((s) => (
          <ShapeEl key={s.id} shape={s} selected={false} idx={-1} />
        ))}
        {preview && <ShapeEl shape={preview} selected={false} idx={-1} />}
      </svg>
    </div>
  );
}

/* ─── Main ComponentEditor ───────────────────────────────────────────────── */

export default function ComponentEditor({ form, busy, existingIds = [], onSave, onCancel }) {
  /* ── metadata state ── */
  const [meta, setMeta] = useState({
    id: form.id || '',
    label: form.label || '',
    asset_type: form.asset_type || 'asset',
    default_w: form.default_w || 100,
    default_h: form.default_h || 60,
    view_box: form.view_box ? [...form.view_box] : [0, 0, 100, 60],
    _idTouched: !form._isNew,
    _wTouched: false,
    _hTouched: false,
  });
  const isNew = !!form._isNew;

  /* ── draw state ── */
  const [mode, setMode] = useState('draw');
  const [tool, setTool] = useState('select');
  const [shapes, setShapes] = useState(() => {
    const markup = form.svg_markup || '';
    if (!markup) return [];
    const { shapes: parsed } = markupToShapes(markup);
    return parsed;
  });
  const nextIdRef = useRef(1);
  useEffect(() => {
    nextIdRef.current = shapes.reduce((m, s) => Math.max(m, (s.id || 0) + 1), 1);
  }, []); // run only on mount

  const [selectedIdx, setSelectedIdx] = useState(-1);
  const [fillColor, setFillColor] = useState('#dbeafe');
  const [strokeColor, setStrokeColor] = useState('#2563eb');
  const [strokeWidth, setStrokeWidth] = useState(1.5);
  const [borderRadius, setBorderRadius] = useState(2);

  /* preview shape while drawing */
  const [previewShape, setPreviewShape] = useState(null);

  /* drag/resize bookkeeping — stored in refs to avoid re-renders on every mousemove */
  const dragRef = useRef({
    active: false,
    kind: null, // 'draw' | 'move' | 'resize'
    handle: null,
    start: null,
    offset: null,
  });

  /* ── code mode state ── */
  const initialMarkup = form.svg_markup || '';
  const [codeMarkup, setCodeMarkup] = useState(initialMarkup);
  const [codeError, setCodeError] = useState('');

  /* ── error state ── */
  const [validationError, setValidationError] = useState('');

  /* ── shape props panel ── */
  const selectedShape = selectedIdx >= 0 ? shapes[selectedIdx] : null;
  const [shapeProps, setShapeProps] = useState({});
  useEffect(() => {
    if (!selectedShape) { setShapeProps({}); return; }
    if (selectedShape.type === 'line') {
      setShapeProps({ x1: svgNum(selectedShape.x1), y1: svgNum(selectedShape.y1), x2: svgNum(selectedShape.x2), y2: svgNum(selectedShape.y2) });
    } else {
      setShapeProps({ x: svgNum(selectedShape.x), y: svgNum(selectedShape.y), w: svgNum(selectedShape.w), h: svgNum(selectedShape.h), rx: svgNum(selectedShape.type === 'rect' ? (selectedShape.rx || 0) : 0) });
    }
  }, [selectedIdx, selectedShape]);

  /* ── SVG canvas ref ── */
  const svgRef = useRef(null);

  /* ── SVG coordinate helper ── */
  const svgPoint = useCallback((e) => {
    const svg = svgRef.current;
    if (!svg) return { x: 0, y: 0 };
    const pt = svg.createSVGPoint();
    pt.x = e.clientX;
    pt.y = e.clientY;
    const inv = svg.getScreenCTM().inverse();
    const transformed = pt.matrixTransform(inv);
    return { x: Math.round(transformed.x * 10) / 10, y: Math.round(transformed.y * 10) / 10 };
  }, []);

  /* ─── Sync shapes viewBox automatically ────────────────────────────────── */
  const syncViewBoxFromShapes = useCallback((nextShapes) => {
    setMeta((prev) => {
      if (prev._wTouched || prev._hTouched) return prev;
      const b = boundsFromShapes(nextShapes);
      if (!b) return prev;
      return {
        ...prev,
        view_box: [svgNum(b.minX), svgNum(b.minY), svgNum(b.w), svgNum(b.h)],
        default_w: Math.round(b.w),
        default_h: Math.round(b.h),
      };
    });
  }, []);

  /* ─── Mode switching ────────────────────────────────────────────────────── */
  function switchMode(next) {
    if (next === mode) return;
    if (next === 'code') {
      setCodeMarkup(shapesToMarkup(shapes));
      setCodeError('');
    } else {
      // parse code → shapes
      const code = codeMarkup.trim();
      if (code) {
        const { shapes: parsed, nextId } = markupToShapes(code, 1);
        if (parsed.length) {
          nextIdRef.current = nextId;
          setShapes(parsed);
          syncViewBoxFromShapes(parsed);
        }
      }
      setSelectedIdx(-1);
      setPreviewShape(null);
    }
    setMode(next);
  }

  /* ─── Tool selection ────────────────────────────────────────────────────── */
  function selectTool(t) {
    setTool(t);
    setSelectedIdx(-1);
  }

  /* ─── Load selected shape props to toolbar ──────────────────────────────── */
  function loadSelectedToToolbar(s) {
    if (!s) return;
    if (s.fill && s.fill !== 'none') setFillColor(s.fill);
    if (s.stroke) setStrokeColor(s.stroke);
    if (s.strokeWidth != null) setStrokeWidth(s.strokeWidth);
    if (s.rx != null) setBorderRadius(s.rx);
  }

  /* ─── Apply toolbar props to selected shape ─────────────────────────────── */
  function applyToolbarToSelected(idx, fill, stroke, sw, rx, nextShapes) {
    const arr = nextShapes ? [...nextShapes] : [...shapes];
    if (idx < 0 || idx >= arr.length) return arr;
    const s = { ...arr[idx] };
    if (s.type !== 'line') s.fill = fill;
    s.stroke = stroke;
    s.strokeWidth = sw;
    if (s.type === 'rect') s.rx = rx;
    arr[idx] = s;
    return arr;
  }

  /* ─── Pointer events ────────────────────────────────────────────────────── */

  const onMouseDown = useCallback((e) => {
    if (mode !== 'draw') return;
    e.preventDefault();
    const pt = svgPoint(e);
    const svg = svgRef.current;

    // Check handle first
    const handleEl = e.target.closest('[data-handle]');
    if (handleEl && selectedIdx >= 0) {
      dragRef.current = { active: true, kind: 'resize', handle: parseInt(handleEl.dataset.handle, 10), start: pt, offset: null };
      svg.setPointerCapture(e.pointerId);
      return;
    }

    if (tool === 'select') {
      const shapeEl = e.target.closest('[data-shape-idx]');
      const idx = shapeEl ? parseInt(shapeEl.dataset.shapeIdx, 10) : hitTestShapes(shapes, pt);
      setSelectedIdx(idx);
      if (idx >= 0) {
        const s = shapes[idx];
        loadSelectedToToolbar(s);
        const offset = s.type === 'line'
          ? { x: pt.x - s.x1, y: pt.y - s.y1 }
          : { x: pt.x - s.x, y: pt.y - s.y };
        dragRef.current = { active: true, kind: 'move', handle: null, start: pt, offset };
        svg.setPointerCapture(e.pointerId);
      }
      return;
    }

    // Start drawing
    dragRef.current = { active: true, kind: 'draw', handle: null, start: pt, offset: null };
    setSelectedIdx(-1);
    svg.setPointerCapture(e.pointerId);
  }, [mode, tool, shapes, selectedIdx, svgPoint]);

  const onMouseMove = useCallback((e) => {
    if (mode !== 'draw') return;
    const d = dragRef.current;
    if (!d.active) return;
    const pt = svgPoint(e);

    if (d.kind === 'resize') {
      setShapes((prev) => {
        const arr = [...prev];
        const s = { ...arr[selectedIdx] };
        const h = d.handle;
        const minSize = 4;
        if (s.type === 'line') {
          if (h === 0) { s.x1 = pt.x; s.y1 = pt.y; }
          else { s.x2 = pt.x; s.y2 = pt.y; }
        } else {
          if (h === 0) { const nx = Math.min(pt.x, s.x + s.w - minSize), ny = Math.min(pt.y, s.y + s.h - minSize); s.w += s.x - nx; s.h += s.y - ny; s.x = nx; s.y = ny; }
          else if (h === 1) { s.w = Math.max(minSize, pt.x - s.x); const ny = Math.min(pt.y, s.y + s.h - minSize); s.h += s.y - ny; s.y = ny; }
          else if (h === 2) { const nx = Math.min(pt.x, s.x + s.w - minSize); s.w += s.x - nx; s.x = nx; s.h = Math.max(minSize, pt.y - s.y); }
          else { s.w = Math.max(minSize, pt.x - s.x); s.h = Math.max(minSize, pt.y - s.y); }
        }
        arr[selectedIdx] = s;
        return arr;
      });
      return;
    }

    if (d.kind === 'move') {
      setShapes((prev) => {
        const arr = [...prev];
        const s = { ...arr[selectedIdx] };
        if (s.type === 'line') {
          const dx = pt.x - d.offset.x - s.x1;
          const dy = pt.y - d.offset.y - s.y1;
          s.x1 += dx; s.y1 += dy; s.x2 += dx; s.y2 += dy;
        } else {
          s.x = pt.x - d.offset.x;
          s.y = pt.y - d.offset.y;
        }
        arr[selectedIdx] = s;
        return arr;
      });
      return;
    }

    if (d.kind === 'draw') {
      const preview = createShape(tool, d.start, pt, fillColor, strokeColor, strokeWidth, borderRadius);
      setPreviewShape(preview);
    }
  }, [mode, tool, selectedIdx, svgPoint, fillColor, strokeColor, strokeWidth, borderRadius]);

  const onMouseUp = useCallback((e) => {
    if (mode !== 'draw') return;
    const d = dragRef.current;
    if (!d.active) return;
    const pt = svgPoint(e);

    if (d.kind === 'draw') {
      const shape = createShape(tool, d.start, pt, fillColor, strokeColor, strokeWidth, borderRadius);
      if (shape) {
        shape.id = nextIdRef.current++;
        const next = [...shapes, shape];
        setShapes(next);
        setSelectedIdx(next.length - 1);
        syncViewBoxFromShapes(next);
        selectTool('select');
      }
    }

    setPreviewShape(null);
    dragRef.current = { active: false, kind: null, handle: null, start: null, offset: null };
  }, [mode, tool, shapes, svgPoint, fillColor, strokeColor, strokeWidth, borderRadius, syncViewBoxFromShapes]);

  /* ─── Delete selected ───────────────────────────────────────────────────── */
  function deleteSelected() {
    if (selectedIdx < 0) return;
    const next = shapes.filter((_, i) => i !== selectedIdx);
    setShapes(next);
    setSelectedIdx(-1);
    syncViewBoxFromShapes(next);
  }

  /* ─── Layer ordering ────────────────────────────────────────────────────── */
  function bringToFront() {
    if (selectedIdx < 0 || selectedIdx >= shapes.length - 1) return;
    const arr = [...shapes];
    const [s] = arr.splice(selectedIdx, 1);
    arr.push(s);
    setShapes(arr);
    setSelectedIdx(arr.length - 1);
  }

  function sendToBack() {
    if (selectedIdx <= 0) return;
    const arr = [...shapes];
    const [s] = arr.splice(selectedIdx, 1);
    arr.unshift(s);
    setShapes(arr);
    setSelectedIdx(0);
  }

  /* ─── Toolbar color/stroke changes ─────────────────────────────────────── */
  function onFillChange(val) {
    setFillColor(val);
    if (selectedIdx >= 0) {
      setShapes((prev) => applyToolbarToSelected(selectedIdx, val, strokeColor, strokeWidth, borderRadius, prev));
    }
  }
  function onStrokeChange(val) {
    setStrokeColor(val);
    if (selectedIdx >= 0) {
      setShapes((prev) => applyToolbarToSelected(selectedIdx, fillColor, val, strokeWidth, borderRadius, prev));
    }
  }
  function onStrokeWidthChange(val) {
    setStrokeWidth(val);
    if (selectedIdx >= 0) {
      setShapes((prev) => applyToolbarToSelected(selectedIdx, fillColor, strokeColor, val, borderRadius, prev));
    }
  }
  function onBorderRadiusChange(val) {
    setBorderRadius(val);
    if (selectedIdx >= 0) {
      setShapes((prev) => applyToolbarToSelected(selectedIdx, fillColor, strokeColor, strokeWidth, val, prev));
    }
  }

  /* ─── Shape props panel changes ─────────────────────────────────────────── */
  function applyShapePropsField(field, val) {
    setShapeProps((prev) => ({ ...prev, [field]: val }));
    setShapes((prev) => {
      if (selectedIdx < 0) return prev;
      const arr = [...prev];
      const s = { ...arr[selectedIdx] };
      const n = parseFloat(String(val).replace(',', '.'));
      if (!Number.isFinite(n)) return prev;
      if (field in s) { s[field] = n; }
      if (field === 'rx') { s.rx = Math.max(0, Math.min(n, s.w / 2, s.h / 2)); setBorderRadius(s.rx); }
      arr[selectedIdx] = s;
      return arr;
    });
  }

  /* ─── Keyboard shortcuts ─────────────────────────────────────────────────── */
  useEffect(() => {
    function onKeyDown(e) {
      if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA' || e.target.tagName === 'SELECT') return;
      if (mode === 'draw') {
        if (e.key === 'v' || e.key === 'V') { selectTool('select'); e.preventDefault(); }
        else if (e.key === 'r' || e.key === 'R') { selectTool('rect'); e.preventDefault(); }
        else if (e.key === 'u' || e.key === 'U') { selectTool('roundrect'); e.preventDefault(); }
        else if (e.key === 'o' || e.key === 'O') { selectTool('ellipse'); e.preventDefault(); }
        else if (e.key === 'l' || e.key === 'L') { selectTool('line'); e.preventDefault(); }
        else if ((e.key === 'Delete' || e.key === 'Backspace') && selectedIdx >= 0) {
          deleteSelected(); e.preventDefault();
        }
        else if (e.key === 'Escape') { setSelectedIdx(-1); }
      }
    }
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [mode, selectedIdx, shapes]);

  /* ─── Code mode preview ──────────────────────────────────────────────────── */
  const codePreviewSafe = isSafeSvgMarkup(codeMarkup);
  const codePreviewVb = codePreviewSafe ? boundsFromMarkup(codeMarkup) : '0 0 100 60';

  /* ─── Save ───────────────────────────────────────────────────────────────── */
  function handleSave(e) {
    e.preventDefault();
    setValidationError('');

    let svgMarkup = '';
    if (mode === 'draw') {
      svgMarkup = shapesToMarkup(shapes);
    } else {
      svgMarkup = codeMarkup.trim();
    }

    if (!svgMarkup) { setValidationError('Нарисуйте фигуры или вставьте SVG-разметку.'); return; }
    if (!isSafeSvgMarkup(svgMarkup)) { setValidationError('SVG содержит небезопасные элементы: script, обработчики событий и т.п.'); return; }
    if (!meta.label.trim()) { setValidationError('Название обязательно.'); return; }

    const id = meta.id.trim();
    if (!id || !/^[A-Za-z_][A-Za-z0-9_.:-]{0,119}$/.test(id)) {
      setValidationError('ID должен начинаться с буквы или подчёркивания и содержать только A-Z, 0-9, _, ., :, -');
      return;
    }
    if (isNew && existingIds.includes(id)) {
      setValidationError(`Компонент с ID "${id}" уже существует.`);
      return;
    }

    const vbStr = boundsFromMarkup(svgMarkup);
    const vbParts = vbStr.split(' ').map(Number);
    const view_box = vbParts.length === 4 ? vbParts : [...meta.view_box];

    onSave({
      id,
      label: meta.label.trim(),
      asset_type: meta.asset_type,
      view_box,
      default_w: meta.default_w,
      default_h: meta.default_h,
      svg_markup: svgMarkup,
    });
  }

  /* ─── viewBox display string ──────────────────────────────────────────────── */
  // Add padding around the component's native viewBox so shapes appear at a
  // reasonable size in the editing canvas (≈ 25-30% of canvas area).
  const canvasViewBox = (() => {
    const [vx, vy, vw, vh] = meta.view_box;
    const pad = Math.max(vw, vh) * 1.5;
    return `${vx - pad} ${vy - pad} ${vw + pad * 2} ${vh + pad * 2}`;
  })();

  /* ─── Render ─────────────────────────────────────────────────────────────── */
  return (
    <div className="ce-root">
      {/* Header */}
      <div className="ce-header">
        <h2 className="ce-title">{isNew ? 'Новый компонент' : `Редактирование: ${form.id}`}</h2>
        <div className="ce-header-actions">
          <button type="button" className="ce-btn ce-btn-ghost" onClick={onCancel} title="Отмена">
            <X size={18} />
            Отмена
          </button>
          <button type="button" className="ce-btn ce-btn-primary" onClick={handleSave} disabled={busy}>
            <Check size={18} />
            {busy ? 'Сохранение…' : 'Сохранить компонент'}
          </button>
        </div>
      </div>

      {validationError && (
        <div className="ce-error-banner" role="alert">{validationError}</div>
      )}

      <div className="ce-layout">
        {/* ── Left sidebar: metadata + toolbar ── */}
        <aside className="ce-sidebar">
          <section className="ce-section">
            <h3 className="ce-section-title">Метаданные</h3>
            <div className="ce-field">
              <label htmlFor="ce-label">Название</label>
              <input
                id="ce-label"
                value={meta.label}
                onChange={(e) => {
                  const label = e.target.value;
                  setMeta((prev) => ({
                    ...prev,
                    label,
                    id: prev._idTouched ? prev.id : slugify(label),
                  }));
                }}
                placeholder="Мой стол"
                maxLength={120}
              />
            </div>
            <div className="ce-field">
              <label htmlFor="ce-id">ID компонента</label>
              <input
                id="ce-id"
                value={meta.id}
                onChange={(e) => setMeta((prev) => ({ ...prev, id: e.target.value, _idTouched: true }))}
                disabled={!isNew}
                placeholder="moy-stol"
                pattern="^[A-Za-z_][A-Za-z0-9_.:-]{0,119}$"
                title="Начинается с буквы/подчёркивания, далее A-Z 0-9 _ . : -"
              />
              {!isNew && <span className="ce-field-hint">ID заблокирован, чтобы не сломать уже размещённые объекты.</span>}
            </div>
            <div className="ce-field">
              <label htmlFor="ce-asset-type">Тип объекта</label>
              <select id="ce-asset-type" value={meta.asset_type} onChange={(e) => setMeta((prev) => ({ ...prev, asset_type: e.target.value }))}>
                {ASSET_TYPES.map((t) => <option key={t} value={t}>{assetTypeLabel(t)}</option>)}
              </select>
            </div>
            <div className="ce-field-row">
              <div className="ce-field">
                <label htmlFor="ce-dw">Ширина по умолчанию</label>
                <input id="ce-dw" type="number" min={1} max={10000} value={meta.default_w}
                  onChange={(e) => setMeta((prev) => ({ ...prev, default_w: Number(e.target.value), _wTouched: true }))} />
              </div>
              <div className="ce-field">
                <label htmlFor="ce-dh">Высота по умолчанию</label>
                <input id="ce-dh" type="number" min={1} max={10000} value={meta.default_h}
                  onChange={(e) => setMeta((prev) => ({ ...prev, default_h: Number(e.target.value), _hTouched: true }))} />
              </div>
            </div>
          </section>

          {mode === 'draw' && (
            <>
              {/* Tool palette */}
              <section className="ce-section">
                <h3 className="ce-section-title">Инструменты</h3>
                <div className="ce-tool-palette">
                  {TOOLS.map(({ id: tid, label, Icon }) => (
                    <button
                      key={tid}
                      type="button"
                      className={`ce-tool-btn${tool === tid ? ' active' : ''}`}
                      title={label}
                      onClick={() => selectTool(tid)}
                    >
                      <Icon size={16} />
                    </button>
                  ))}
                </div>
              </section>

              {/* Style controls */}
              <section className="ce-section">
                <h3 className="ce-section-title">Стиль</h3>
                <div className="ce-style-grid">
                  <div className="ce-field">
                    <label>Заливка</label>
                    <div className="ce-color-row">
                      <div className="ce-swatch" style={{ background: fillColor }} onClick={() => document.getElementById('ce-fill-input').click()} />
                      <input id="ce-fill-input" type="color" value={fillColor} onChange={(e) => onFillChange(e.target.value)} className="ce-color-hidden" />
                      <span className="ce-color-val">{fillColor}</span>
                    </div>
                  </div>
                  <div className="ce-field">
                    <label>Обводка</label>
                    <div className="ce-color-row">
                      <div className="ce-swatch" style={{ background: strokeColor }} onClick={() => document.getElementById('ce-stroke-input').click()} />
                      <input id="ce-stroke-input" type="color" value={strokeColor} onChange={(e) => onStrokeChange(e.target.value)} className="ce-color-hidden" />
                      <span className="ce-color-val">{strokeColor}</span>
                    </div>
                  </div>
                  <div className="ce-field">
                    <label htmlFor="ce-sw">Толщина обводки</label>
                    <div className="ce-slider-row">
                      <input id="ce-sw" type="range" min={0.5} max={8} step={0.5} value={strokeWidth} onChange={(e) => onStrokeWidthChange(parseFloat(e.target.value))} />
                      <span className="ce-slider-val">{strokeWidth}</span>
                    </div>
                  </div>
                  <div className="ce-field">
                    <label htmlFor="ce-rx">Скругление</label>
                    <div className="ce-slider-row">
                      <input id="ce-rx" type="range" min={0} max={40} step={1} value={borderRadius} onChange={(e) => onBorderRadiusChange(parseFloat(e.target.value))} />
                      <span className="ce-slider-val">{borderRadius}</span>
                    </div>
                  </div>
                </div>
              </section>

              {/* Selected shape properties */}
              <section className="ce-section">
                <h3 className="ce-section-title">
                  {selectedShape
                    ? `${shapeTypeLabel(selectedShape.type)} #${selectedIdx + 1}`
                    : 'Свойства фигуры'}
                </h3>
                {!selectedShape && <p className="ce-empty-hint">Выберите фигуру, чтобы редактировать свойства.</p>}
                {selectedShape && selectedShape.type === 'line' && (
                  <div className="ce-props-grid">
                    {(['x1','y1','x2','y2']).map((f) => (
                      <div className="ce-field" key={f}>
                        <label>{f.toUpperCase()}</label>
                        <input type="number" value={shapeProps[f] ?? ''} onChange={(e) => applyShapePropsField(f, e.target.value)} />
                      </div>
                    ))}
                  </div>
                )}
                {selectedShape && selectedShape.type !== 'line' && (
                  <div className="ce-props-grid">
                    {(['x','y','w','h']).map((f) => (
                      <div className="ce-field" key={f}>
                        <label>{f.toUpperCase()}</label>
                        <input type="number" value={shapeProps[f] ?? ''} onChange={(e) => applyShapePropsField(f, e.target.value)} />
                      </div>
                    ))}
                    {selectedShape.type === 'rect' && (
                      <div className="ce-field ce-field-full">
                        <label>Скругление углов</label>
                        <input type="number" min={0} value={shapeProps.rx ?? 0} onChange={(e) => applyShapePropsField('rx', e.target.value)} />
                      </div>
                    )}
                  </div>
                )}
                {selectedShape && (
                  <div className="ce-shape-actions">
                    <button type="button" className="ce-btn ce-btn-sm" onClick={bringToFront} title="На передний план">↑ Вперёд</button>
                    <button type="button" className="ce-btn ce-btn-sm" onClick={sendToBack} title="На задний план">↓ Назад</button>
                    <button type="button" className="ce-btn ce-btn-sm ce-btn-danger" onClick={deleteSelected} title="Удалить фигуру">Удалить</button>
                  </div>
                )}
              </section>
            </>
          )}
        </aside>

        {/* ── Main canvas area ── */}
        <main className="ce-main">
          {/* Mode tabs */}
          <div className="ce-mode-tabs">
            <button
              type="button"
              className={`ce-tab${mode === 'draw' ? ' active' : ''}`}
              onClick={() => switchMode('draw')}
            >
              Рисовать
            </button>
            <button
              type="button"
              className={`ce-tab${mode === 'code' ? ' active' : ''}`}
              onClick={() => switchMode('code')}
            >
              Код
            </button>
          </div>

          {mode === 'draw' && (
            <div className="ce-canvas-wrap" style={{ cursor: tool === 'select' ? 'default' : 'crosshair' }}>
              <svg
                ref={svgRef}
                className="ce-canvas"
                viewBox={canvasViewBox}
                xmlns="http://www.w3.org/2000/svg"
                onMouseDown={onMouseDown}
                onMouseMove={onMouseMove}
                onMouseUp={onMouseUp}
              >
                {/* Grid (decorative, does not scale with viewBox) */}
                <defs>
                  <pattern id="ce-grid" width="10" height="10" patternUnits="userSpaceOnUse">
                    <path d="M 10 0 L 0 0 0 10" fill="none" stroke="#e2e8f0" strokeWidth="0.5" />
                  </pattern>
                </defs>
                <rect width="100%" height="100%" fill="url(#ce-grid)" />

                <g id="ce-shapes">
                  {shapes.map((s, i) => (
                    <ShapeEl
                      key={s.id}
                      shape={s}
                      selected={i === selectedIdx}
                      idx={i}
                      onMouseDown={onMouseDown}
                    />
                  ))}
                  {previewShape && (
                    <ShapeEl shape={previewShape} selected={false} idx={-1} />
                  )}
                </g>
              </svg>
              {!shapes.length && !previewShape && (
                <div className="ce-canvas-empty">
                  Зажмите и протяните на холсте, чтобы нарисовать фигуру
                </div>
              )}
            </div>
          )}

          {mode === 'code' && (
            <div className="ce-code-pane">
              <textarea
                className="ce-code-area"
                value={codeMarkup}
                onChange={(e) => {
                  setCodeMarkup(e.target.value);
                  setCodeError(!isSafeSvgMarkup(e.target.value) ? 'SVG содержит небезопасные элементы.' : '');
                }}
                spellCheck={false}
                placeholder={'<rect x="0" y="0" width="100" height="60" rx="6" fill="#dbeafe" stroke="#2563eb" stroke-width="1.5"/>'}
                rows={14}
              />
              {codeError && <p className="ce-code-error">{codeError}</p>}
              <div className="ce-code-preview">
                <span className="ce-preview-label">Живой предпросмотр</span>
                {codePreviewSafe && codeMarkup.trim() ? (
                  <div
                    className="ce-preview-box"
                    dangerouslySetInnerHTML={{
                      __html: `<svg viewBox="${codePreviewVb}" xmlns="http://www.w3.org/2000/svg" style="width:100%;height:100%">${codeMarkup}</svg>`,
                    }}
                  />
                ) : (
                  <div className="ce-preview-box ce-preview-empty">
                    {!codeMarkup.trim() ? 'Введите SVG-разметку выше' : 'SVG содержит небезопасное содержимое'}
                  </div>
                )}
              </div>
            </div>
          )}
        </main>

        {/* ── Right preview panel ── */}
        <aside className="ce-right-panel">
          <h3 className="ce-section-title">Предпросмотр</h3>
          <p className="ce-empty-hint" style={{ marginBottom: 8 }}>В реальном размере ({meta.default_w}×{meta.default_h})</p>
          {mode === 'draw' ? (
            <DrawPreview shapes={shapes} preview={previewShape} viewBox={meta.view_box} />
          ) : (
            codePreviewSafe && codeMarkup.trim() ? (
              <div
                className="ce-preview-box"
                dangerouslySetInnerHTML={{
                  __html: `<svg viewBox="${codePreviewVb}" xmlns="http://www.w3.org/2000/svg" style="width:100%;height:100%">${codeMarkup}</svg>`,
                }}
              />
            ) : (
              <div className="ce-preview-box ce-preview-empty">Нет предпросмотра</div>
            )
          )}
          <div className="ce-viewbox-display">
            <span>viewBox</span>
            <code>{meta.view_box.join(' ')}</code>
          </div>
        </aside>
      </div>
    </div>
  );
}
