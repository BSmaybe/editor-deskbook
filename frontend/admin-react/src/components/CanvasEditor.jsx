/**
 * CanvasEditor — SVG-based floor plan canvas.
 *
 * Renders a full SVG viewport with:
 *  - viewBox-based pan/zoom (useViewport)
 *  - snap-to-grid (useGrid)
 *  - click + marquee selection (useSelection)
 *  - undo/redo (useUndoRedo)
 *  - desk move drag
 *  - grid lines layer
 *  - structure (walls/boundaries/partitions/doors) render layer
 *  - selection overlay (bounding box + handles)
 *  - marquee rubber band
 *  - toolbar and status bar
 *
 * Drawing tools for walls/desks are intentionally out of scope here and
 * will be added in a later phase. The canvas wires up all the hooks and
 * exposes a clean, minimal API to the parent (LayoutPanel).
 *
 * Props:
 *  layout          {object}   — layout document: { desks, walls, boundaries, ... }
 *  floorId         {string}
 *  components      {Array}    — component catalog for default sizes
 *  onLayoutChange  {Function} — called after a successful save
 *  onNotice        {Function}
 *  onError         {Function}
 */

import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import {
  Grid3X3,
  Maximize,
  Move,
  MousePointer,
  Redo2,
  RotateCcw,
  Save,
  Trash2,
  Undo2,
  ZoomIn,
  ZoomOut,
} from 'lucide-react';
import { apiFetch } from '../lib/api.js';
import { useViewport } from '../lib/canvas/useViewport.js';
import { useGrid } from '../lib/canvas/useGrid.js';
import { useSelection } from '../lib/canvas/useSelection.js';
import { useUndoRedo } from '../lib/canvas/useUndoRedo.js';
import { findObjectAtPoint } from '../lib/canvas/hitTest.js';
import './CanvasEditor.css';

/* ── constants ── */

const DESK_COLORS = {
  flex:     { fill: '#dbeafe', stroke: '#2563eb' },
  fixed:    { fill: '#fef3c7', stroke: '#d97706' },
  disabled: { fill: '#f1f5f9', stroke: '#94a3b8' },
  occupied: { fill: '#fee2e2', stroke: '#dc2626' },
};
const DEFAULT_DESK_COLOR = DESK_COLORS.flex;

const STRUCT_COLORS = {
  wall:      '#2f343b',
  boundary:  '#1d4ed8',
  partition: '#4b5563',
  door:      '#60a5fa',
};

const STRUCT_OPACITY = {
  wall: 1, boundary: 0.3, partition: 0.7, door: 1,
};

/* Minimum drag distance (SVG user-units) before we start moving desks. */
const DRAG_MIN = 3;

/* ── helpers ── */

let _uidCtr = 0;
function uid(prefix = 'obj') {
  return `${prefix}-${Date.now().toString(36)}-${(++_uidCtr).toString(36)}`;
}

function deskFill(desk) {
  if (!desk.bookable) return DESK_COLORS.disabled.fill;
  if (desk.fixed) return DESK_COLORS.fixed.fill;
  return DEFAULT_DESK_COLOR.fill;
}

function deskStroke(desk, selected) {
  if (selected) return '#2563eb';
  if (!desk.bookable) return DESK_COLORS.disabled.stroke;
  if (desk.fixed) return DESK_COLORS.fixed.stroke;
  return DEFAULT_DESK_COLOR.stroke;
}

function boundingBoxOf(desks, ids) {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const d of desks) {
    if (ids && !ids.has(d.id)) continue;
    const x = d.x || 0, y = d.y || 0, w = d.w || 100, h = d.h || 60;
    if (x < minX) minX = x;
    if (y < minY) minY = y;
    if (x + w > maxX) maxX = x + w;
    if (y + h > maxY) maxY = y + h;
  }
  if (!Number.isFinite(minX)) return null;
  return { x: minX, y: minY, w: maxX - minX, h: maxY - minY };
}

function ptFromArr(p) {
  if (!p) return { x: 0, y: 0 };
  return Array.isArray(p) ? { x: Number(p[0]), y: Number(p[1]) } : { x: Number(p.x ?? 0), y: Number(p.y ?? 0) };
}

/* ── component ── */

export default function CanvasEditor({
  layout,
  floorId,
  components,
  onLayoutChange,
  onNotice,
  onError,
}) {
  /* ── canvas dimensions from layout ── */
  const canvasW = useMemo(() => {
    const vb = layout?.layout?.vb;
    return (Array.isArray(vb) ? vb[2] : null) || layout?.layout?.canvas_width || 1200;
  }, [layout]);
  const canvasH = useMemo(() => {
    const vb = layout?.layout?.vb;
    return (Array.isArray(vb) ? vb[3] : null) || layout?.layout?.canvas_height || 800;
  }, [layout]);

  /* ── hooks ── */
  const viewport = useViewport({ contentW: canvasW, contentH: canvasH });
  const grid = useGrid({ defaultSize: 10, defaultSnap: false, defaultVisible: true });

  /* ── tool mode: 'select' | 'pan' ── */
  const [tool, setTool] = useState('select');

  /* ── local data state ── */
  const [desks, setDesks] = useState([]);
  const [dirty, setDirty] = useState(false);

  // Derived structure arrays from layout
  const walls      = useMemo(() => layout?.layout?.walls      || [], [layout]);
  const boundaries = useMemo(() => layout?.layout?.boundaries || [], [layout]);
  const partitions = useMemo(() => layout?.layout?.partitions || [], [layout]);
  const doors      = useMemo(() => layout?.layout?.doors      || [], [layout]);

  /* ── selection ── */
  const sel = useSelection();

  /* ── undo / redo ── */
  const undoRedo = useUndoRedo({
    enabled: true,
    onRestore: useCallback((snapshot) => {
      setDesks(snapshot.desks);
      sel.clearSelection();
      setDirty(true);
    }, [sel]),
  });

  /* ── drag state (ref — does not need re-render) ── */
  const dragRef = useRef(null);
  // { startSvgPt, origins: Map<id, {x,y}>, moved: boolean }

  /* ── space-key panning ── */
  const spaceRef = useRef(false);
  const isPanningRef = useRef(false);

  /* ── cursor SVG position for status bar ── */
  const [cursorSvgPt, setCursorSvgPt] = useState({ x: 0, y: 0 });

  /* ── saving ── */
  const [saving, setSaving] = useState(false);

  /* ── component size lookup ── */
  const compMap = useMemo(() => {
    const m = new Map();
    for (const c of (components || [])) m.set(c.id, c);
    if (!m.has('desk-short'))           m.set('desk-short', { default_w: 100, default_h: 60 });
    if (!m.has('workplace-desk-chair')) m.set('workplace-desk-chair', { default_w: 140, default_h: 125 });
    return m;
  }, [components]);

  function deskW(d) { return d.w || compMap.get(d.component_id)?.default_w || 100; }
  function deskH(d) { return d.h || compMap.get(d.component_id)?.default_h || 60; }

  /* ── sync layout → local state ── */
  useEffect(() => {
    setDesks(layout?.layout?.desks || []);
    sel.clearSelection();
    setDirty(false);
    undoRedo.clear();
    // Fit the viewport to the content on load
    setTimeout(() => viewport.zoomToFit({ x: 0, y: 0, w: canvasW, h: canvasH }, 60), 0);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [layout]);

  /* ── wheel zoom — must be non-passive ── */
  useEffect(() => {
    const el = viewport.svgRef.current;
    if (!el) return;
    el.addEventListener('wheel', viewport.onWheel, { passive: false });
    return () => el.removeEventListener('wheel', viewport.onWheel);
  }, [viewport.onWheel, viewport.svgRef]);

  /* ── keyboard ── */
  useEffect(() => {
    function onKeyDown(e) {
      if (e.code === 'Space' && !spaceRef.current) {
        const tag = e.target?.tagName?.toLowerCase?.();
        if (tag === 'input' || tag === 'textarea') return;
        e.preventDefault();
        spaceRef.current = true;
        setTool('pan');
      }

      const meta = e.metaKey || e.ctrlKey;
      const tag = e.target?.tagName?.toLowerCase?.();
      const inInput = tag === 'input' || tag === 'textarea' || tag === 'select';

      if (e.key === 'Escape') {
        sel.clearSelection();
        dragRef.current = null;
        return;
      }

      if ((e.key === 'Delete' || e.key === 'Backspace') && sel.selectedIds.size && !inInput) {
        e.preventDefault();
        deleteSelected();
        return;
      }

      if (meta && e.key === 'z' && !e.shiftKey && !inInput) {
        e.preventDefault();
        undoRedo.undo({ desks });
        return;
      }

      if (meta && (e.key === 'y' || (e.key === 'z' && e.shiftKey)) && !inInput) {
        e.preventDefault();
        undoRedo.redo({ desks });
        return;
      }

      // Arrow nudge
      if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.key) && sel.selectedIds.size && !inInput) {
        e.preventDefault();
        const step = e.shiftKey ? 10 : 1;
        const dx = e.key === 'ArrowRight' ? step : e.key === 'ArrowLeft' ? -step : 0;
        const dy = e.key === 'ArrowDown'  ? step : e.key === 'ArrowUp'   ? -step : 0;
        modifyDesks((prev) =>
          prev.map((d) =>
            sel.selectedIds.has(d.id)
              ? { ...d, x: (d.x || 0) + dx, y: (d.y || 0) + dy }
              : d,
          ),
        );
      }
    }

    function onKeyUp(e) {
      if (e.code === 'Space') {
        spaceRef.current = false;
        isPanningRef.current = false;
        viewport.endPan();
        setTool('select');
      }
    }

    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sel.selectedIds, desks]);

  /* ── data mutations ── */

  function modifyDesks(updater) {
    undoRedo.push({ desks });
    setDesks(updater);
    setDirty(true);
  }

  function deleteSelected() {
    if (!sel.selectedIds.size) return;
    modifyDesks((prev) => prev.filter((d) => !sel.selectedIds.has(d.id)));
    sel.clearSelection();
  }

  /* ── pointer handlers ── */

  const onSvgPointerDown = useCallback((e) => {
    const svgEl = viewport.svgRef.current;
    if (!svgEl) return;

    const pt = viewport.screenToSvg(e);

    // Middle-click or space+left → pan
    if (e.button === 1 || (e.button === 0 && spaceRef.current)) {
      e.preventDefault();
      isPanningRef.current = true;
      viewport.startPan(e);
      svgEl.setPointerCapture(e.pointerId);
      return;
    }

    if (e.button !== 0) return;

    // Pan tool
    if (tool === 'pan') {
      isPanningRef.current = true;
      viewport.startPan(e);
      svgEl.setPointerCapture(e.pointerId);
      return;
    }

    // Select tool — hit test
    const layout = buildLayoutForHitTest();
    const hit = findObjectAtPoint(pt, layout, viewport.worldUnitsForPx(14));

    if (hit?.type === 'desk') {
      // Desk click
      if (e.shiftKey) {
        sel.toggleId(hit.id);
      } else if (!sel.selectedIds.has(hit.id)) {
        sel.selectOne(hit.id);
      }
      // Begin drag
      const ids = e.shiftKey ? sel.selectedIds : (sel.selectedIds.has(hit.id) ? sel.selectedIds : new Set([hit.id]));
      const origins = new Map();
      for (const id of ids) {
        const d = desks.find((dd) => dd.id === id);
        if (d) origins.set(id, { x: d.x || 0, y: d.y || 0 });
      }
      dragRef.current = { startSvgPt: pt, origins, moved: false };
      svgEl.setPointerCapture(e.pointerId);
      return;
    }

    // Click on empty space → start marquee
    if (!e.shiftKey) sel.clearSelection();
    sel.startMarquee(pt, { append: e.shiftKey });
    svgEl.setPointerCapture(e.pointerId);
  }, [tool, viewport, sel, desks]);

  const onSvgPointerMove = useCallback((e) => {
    const pt = viewport.screenToSvg(e);
    setCursorSvgPt(pt);

    // Pan
    if (isPanningRef.current) {
      viewport.updatePan(e);
      return;
    }

    // Desk drag
    if (dragRef.current) {
      const { startSvgPt, origins } = dragRef.current;
      const dx = pt.x - startSvgPt.x;
      const dy = pt.y - startSvgPt.y;

      if (!dragRef.current.moved && Math.hypot(dx, dy) < DRAG_MIN) return;
      dragRef.current.moved = true;

      setDesks((prev) =>
        prev.map((d) => {
          const orig = origins.get(d.id);
          if (!orig) return d;
          return {
            ...d,
            x: grid.snap(orig.x + dx),
            y: grid.snap(orig.y + dy),
          };
        }),
      );
      setDirty(true);
      return;
    }

    // Marquee
    if (sel.marquee) {
      sel.updateMarquee(pt);
    }
  }, [viewport, sel, grid]);

  const onSvgPointerUp = useCallback((e) => {
    const svgEl = viewport.svgRef.current;

    // Pan end
    if (isPanningRef.current) {
      isPanningRef.current = false;
      viewport.endPan();
      try { svgEl?.releasePointerCapture(e.pointerId); } catch {}
      return;
    }

    // Desk drag end
    if (dragRef.current) {
      if (dragRef.current.moved) {
        undoRedo.push({ desks: dragRef.current.origins }); // push pre-drag state
      }
      dragRef.current = null;
      try { svgEl?.releasePointerCapture(e.pointerId); } catch {}
      return;
    }

    // Marquee end
    if (sel.marquee) {
      sel.finishMarquee(desks);
      try { svgEl?.releasePointerCapture(e.pointerId); } catch {}
    }
  }, [viewport, sel, desks, undoRedo]);

  /* ── build a lightweight layout object for hit-testing ── */
  function buildLayoutForHitTest() {
    return { desks, walls, boundaries, partitions, doors };
  }

  /* ── zoom to fit selection or all ── */
  function handleZoomToFit() {
    const bb = sel.selectedIds.size
      ? boundingBoxOf(desks, sel.selectedIds)
      : boundingBoxOf(desks, null) || { x: 0, y: 0, w: canvasW, h: canvasH };
    if (bb) viewport.zoomToFit(bb, 60);
  }

  /* ── save ── */
  async function saveDraft() {
    if (!floorId || !dirty) return;
    setSaving(true);
    onError('');
    try {
      const doc = { ...(layout?.layout || {}), desks };
      await apiFetch(`/floors/${floorId}/layout/draft`, {
        method: 'PUT',
        body: JSON.stringify({ version: layout?.version || 0, layout: doc }),
      });
      setDirty(false);
      onNotice('Черновик сохранён');
      onLayoutChange();
    } catch (err) {
      onError(err.message);
    } finally {
      setSaving(false);
    }
  }

  function resetChanges() {
    setDesks(layout?.layout?.desks || []);
    sel.clearSelection();
    setDirty(false);
    undoRedo.clear();
  }

  /* ── derived ── */
  const selectedDesk = sel.selectedIds.size === 1
    ? desks.find((d) => d.id === [...sel.selectedIds][0])
    : null;

  const selBBox = useMemo(() => {
    if (!sel.selectedIds.size) return null;
    return boundingBoxOf(desks, sel.selectedIds);
  }, [desks, sel.selectedIds]);

  /* ── cursor class ── */
  const cursorClass = isPanningRef.current
    ? 'cursor-panning'
    : (tool === 'pan' || spaceRef.current)
      ? 'cursor-pan'
      : 'cursor-default';

  /* ── grid lines ── */
  const gridLines = useMemo(() => {
    if (!grid.gridVisible || grid.gridSize < 5) return null;
    const cols = Math.ceil(canvasW / grid.gridSize) + 1;
    const rows = Math.ceil(canvasH / grid.gridSize) + 1;
    return { cols, rows };
  }, [grid.gridVisible, grid.gridSize, canvasW, canvasH]);

  /* ── render ── */
  return (
    <div className="ce-root" tabIndex={0}>

      {/* ── Toolbar ── */}
      <div className="ce-toolbar">
        <button
          className={`ce-tool-btn ${tool === 'select' ? 'active' : ''}`}
          title="Select (V)"
          onClick={() => setTool('select')}
        >
          <MousePointer size={14} />
        </button>
        <button
          className={`ce-tool-btn ${tool === 'pan' ? 'active' : ''}`}
          title="Pan (Space+drag or middle-click)"
          onClick={() => setTool('pan')}
        >
          <Move size={14} />
        </button>

        <div className="ce-toolbar-sep" />

        <button className="ce-tool-btn" title="Zoom in" onClick={() => viewport.zoomBy(1 / 1.25)}>
          <ZoomIn size={14} />
        </button>
        <button className="ce-tool-btn" title="Zoom out" onClick={() => viewport.zoomBy(1.25)}>
          <ZoomOut size={14} />
        </button>
        <span className="ce-zoom-label">{Math.round(viewport.zoom * 100)}%</span>
        <button className="ce-tool-btn" title="Zoom to fit (F)" onClick={handleZoomToFit}>
          <Maximize size={14} />
        </button>

        <div className="ce-toolbar-sep" />

        <button
          className={`ce-tool-btn ${grid.gridVisible ? 'active' : ''}`}
          title={`Grid (${grid.gridSize}px) — click to toggle`}
          onClick={grid.toggleVisible}
        >
          <Grid3X3 size={14} />
        </button>
        <button
          className={`ce-tool-btn ${grid.snapOn ? 'active' : ''}`}
          title="Snap to grid"
          onClick={grid.toggleSnap}
          style={{ fontSize: 11 }}
        >
          Snap
        </button>

        {/* Selection actions */}
        {sel.selectedIds.size > 0 && (
          <>
            <div className="ce-toolbar-sep" />
            <button className="ce-tool-btn danger" title="Delete selected (Del)" onClick={deleteSelected}>
              <Trash2 size={14} />
            </button>
          </>
        )}

        <div className="ce-toolbar-spacer" />

        {/* Undo / Redo */}
        <button
          className="ce-tool-btn"
          title="Undo (Ctrl+Z)"
          disabled={!undoRedo.canUndo}
          onClick={() => undoRedo.undo({ desks })}
        >
          <Undo2 size={14} />
        </button>
        <button
          className="ce-tool-btn"
          title="Redo (Ctrl+Shift+Z)"
          disabled={!undoRedo.canRedo}
          onClick={() => undoRedo.redo({ desks })}
        >
          <Redo2 size={14} />
        </button>

        {dirty && (
          <>
            <button className="ce-tool-btn" title="Discard changes" onClick={resetChanges}>
              <RotateCcw size={14} />
            </button>
            <button
              className="ce-tool-btn active"
              title="Save draft"
              onClick={saveDraft}
              disabled={saving}
              style={{ gap: 6 }}
            >
              <Save size={14} />
              <span>{saving ? 'Saving…' : 'Save draft'}</span>
            </button>
          </>
        )}
      </div>

      {/* ── SVG viewport ── */}
      <div className={`ce-viewport ${cursorClass}`}>
        <svg
          ref={viewport.svgRef}
          className="ce-svg"
          viewBox={viewport.viewBoxAttr}
          preserveAspectRatio="xMidYMid meet"
          onPointerDown={onSvgPointerDown}
          onPointerMove={onSvgPointerMove}
          onPointerUp={onSvgPointerUp}
          onPointerLeave={onSvgPointerUp}
        >
          {/* Canvas background */}
          <rect className="ce-bg" width={canvasW} height={canvasH} />

          {/* Grid lines layer */}
          {gridLines && (
            <g className="ce-grid" opacity={0.18}>
              {Array.from({ length: gridLines.cols }, (_, i) => (
                <line
                  key={`gx${i}`}
                  x1={i * grid.gridSize} y1={0}
                  x2={i * grid.gridSize} y2={canvasH}
                  stroke="#94a3b8" strokeWidth={0.5}
                />
              ))}
              {Array.from({ length: gridLines.rows }, (_, i) => (
                <line
                  key={`gy${i}`}
                  x1={0} y1={i * grid.gridSize}
                  x2={canvasW} y2={i * grid.gridSize}
                  stroke="#94a3b8" strokeWidth={0.5}
                />
              ))}
            </g>
          )}

          {/* Structure layer */}
          <g className="ce-structure">
            {boundaries.map((b, i) => {
              const pts = (b.pts || b.points || []).map(ptFromArr);
              return (
                <polygon
                  key={`b${i}`}
                  points={pts.map((p) => `${p.x},${p.y}`).join(' ')}
                  fill={STRUCT_COLORS.boundary}
                  fillOpacity={STRUCT_OPACITY.boundary}
                  stroke={STRUCT_COLORS.boundary}
                  strokeWidth={1.5}
                />
              );
            })}
            {partitions.map((p, i) => {
              const pts = (p.pts || []).map(ptFromArr);
              return (
                <polyline
                  key={`p${i}`}
                  points={pts.map((pt) => `${pt.x},${pt.y}`).join(' ')}
                  fill="none"
                  stroke={STRUCT_COLORS.partition}
                  strokeOpacity={STRUCT_OPACITY.partition}
                  strokeWidth={p.thick || 3}
                  strokeLinecap="round"
                />
              );
            })}
            {walls.map((w, i) => {
              const pts = (w.pts || []).map(ptFromArr);
              if (pts.length >= 2) {
                return (
                  <polyline
                    key={`w${i}`}
                    points={pts.map((p) => `${p.x},${p.y}`).join(' ')}
                    fill="none"
                    stroke={STRUCT_COLORS.wall}
                    strokeWidth={w.thick || 4}
                    strokeLinecap="square"
                  />
                );
              }
              return (
                <line
                  key={`w${i}`}
                  x1={w.x1 || 0} y1={w.y1 || 0}
                  x2={w.x2 || 0} y2={w.y2 || 0}
                  stroke={STRUCT_COLORS.wall}
                  strokeWidth={w.thick || 4}
                />
              );
            })}
            {doors.map((d, i) => {
              const pts = (d.pts || []).map(ptFromArr);
              if (pts.length >= 2) {
                return (
                  <polyline
                    key={`d${i}`}
                    points={pts.map((p) => `${p.x},${p.y}`).join(' ')}
                    fill="none"
                    stroke={STRUCT_COLORS.door}
                    strokeWidth={d.thick || 2.5}
                    strokeDasharray="6 3"
                    strokeLinecap="round"
                  />
                );
              }
              return (
                <line
                  key={`d${i}`}
                  x1={d.x1 || 0} y1={d.y1 || 0}
                  x2={d.x2 || 0} y2={d.y2 || 0}
                  stroke={STRUCT_COLORS.door}
                  strokeWidth={2.5}
                  strokeDasharray="6 3"
                />
              );
            })}
          </g>

          {/* Desks layer */}
          {desks.map((desk) => {
            const w = deskW(desk);
            const h = deskH(desk);
            const x = desk.x || 0;
            const y = desk.y || 0;
            const isSelected = sel.selectedIds.has(desk.id);
            const rotate = desk.r ? ` rotate(${desk.r} ${w / 2} ${h / 2})` : '';
            return (
              <g
                key={desk.id}
                className="ce-desk"
                transform={`translate(${x},${y})${rotate}`}
                data-id={desk.id}
              >
                <rect
                  className="ce-desk-body"
                  width={w}
                  height={h}
                  rx={3}
                  fill={isSelected ? '#dbeafe' : deskFill(desk)}
                  stroke={deskStroke(desk, isSelected)}
                  strokeWidth={isSelected ? 2 : 1}
                />
                <text
                  className="ce-desk-label"
                  x={w / 2}
                  y={h / 2}
                  textAnchor="middle"
                  dominantBaseline="central"
                  fontSize={Math.min(11, w / 7)}
                  fill="#334155"
                >
                  {desk.label || desk.id}
                </text>
              </g>
            );
          })}

          {/* Selection overlay */}
          <g className="ce-selection-overlay">
            {/* Per-desk selected dashes when multi-select */}
            {sel.selectedIds.size > 1 && desks
              .filter((d) => sel.selectedIds.has(d.id))
              .map((desk) => {
                const w = deskW(desk);
                const h = deskH(desk);
                const rotate = desk.r ? ` rotate(${desk.r} ${w / 2} ${h / 2})` : '';
                return (
                  <rect
                    key={`sel-${desk.id}`}
                    transform={`translate(${desk.x || 0},${desk.y || 0})${rotate}`}
                    x={-2} y={-2}
                    width={w + 4} height={h + 4}
                    fill="none"
                    stroke="#2563eb"
                    strokeWidth={1}
                    strokeDasharray="4 2"
                    rx={4}
                    pointerEvents="none"
                  />
                );
              })
            }

            {/* Multi-select aggregate bounding box */}
            {sel.selectedIds.size > 1 && selBBox && (
              <rect
                className="ce-sel-bbox"
                x={selBBox.x - 6} y={selBBox.y - 6}
                width={selBBox.w + 12} height={selBBox.h + 12}
                rx={6}
              />
            )}

            {/* Single-desk selection handles */}
            {selectedDesk && (() => {
              const w = deskW(selectedDesk);
              const h = deskH(selectedDesk);
              const x = selectedDesk.x || 0;
              const y = selectedDesk.y || 0;
              const rotate = selectedDesk.r
                ? ` rotate(${selectedDesk.r} ${x + w / 2} ${y + h / 2})`
                : '';
              const handles = [
                [x,     y    ],
                [x + w, y    ],
                [x,     y + h],
                [x + w, y + h],
              ];
              return (
                <g transform={rotate || undefined}>
                  <rect
                    x={x - 3} y={y - 3}
                    width={w + 6} height={h + 6}
                    fill="none"
                    stroke="#2563eb"
                    strokeWidth={1.5}
                    strokeDasharray="6 3"
                    rx={5}
                    pointerEvents="none"
                  />
                  {handles.map(([hx, hy], i) => (
                    <rect
                      key={i}
                      className="ce-sel-handle"
                      x={hx - 4} y={hy - 4}
                      width={8} height={8}
                      rx={2}
                    />
                  ))}
                </g>
              );
            })()}

            {/* Marquee rubber band */}
            {sel.marqueeRect && (
              <rect
                className="ce-marquee"
                x={sel.marqueeRect.x}
                y={sel.marqueeRect.y}
                width={sel.marqueeRect.w}
                height={sel.marqueeRect.h}
              />
            )}
          </g>
        </svg>
      </div>

      {/* ── Status bar ── */}
      <div className="ce-statusbar">
        <span className="ce-statusbar-item">
          {Math.round(viewport.zoom * 100)}%
        </span>
        <span className="ce-statusbar-sep">·</span>
        <span className="ce-statusbar-item">
          {Math.round(cursorSvgPt.x)}, {Math.round(cursorSvgPt.y)}
        </span>
        <span className="ce-statusbar-sep">·</span>
        <span className="ce-statusbar-item">
          {desks.length} desk{desks.length !== 1 ? 's' : ''}
        </span>
        {sel.selectedIds.size > 0 && (
          <>
            <span className="ce-statusbar-sep">·</span>
            <span className="ce-statusbar-item" style={{ color: '#2563eb' }}>
              {sel.selectedIds.size} selected
            </span>
          </>
        )}
        {dirty && (
          <>
            <span className="ce-statusbar-sep">·</span>
            <span className="ce-statusbar-item" style={{ color: '#d97706' }}>unsaved</span>
          </>
        )}
      </div>
    </div>
  );
}
