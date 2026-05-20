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
 * Drawing tools for walls/boundaries/partitions/doors allow click-to-add-point
 * polyline creation with live preview. Double-click or Enter finishes, Escape cancels.
 *
 * Props:
 *  layout          {object}   — layout document: { desks, walls, boundaries, ... }
 *  floorId         {string}
 *  components      {Array}    — component catalog for default sizes
 *  onLayoutChange  {Function} — called after a successful save
 *  onDirtyChange   {Function}
 *  onNotice        {Function}
 *  onError         {Function}
 */

import React, {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
} from 'react';
import {
  AlignHorizontalJustifyCenter,
  AlignHorizontalJustifyEnd,
  AlignHorizontalJustifyStart,
  AlignHorizontalSpaceBetween,
  AlignVerticalJustifyCenter,
  AlignVerticalJustifyEnd,
  AlignVerticalJustifyStart,
  AlignVerticalSpaceBetween,
  Activity,
  Copy,
  Download,
  DoorOpen,
  Eye,
  EyeOff,
  Grid3X3,
  Group,
  ImageIcon,
  Keyboard,
  Layers,
  Lock,
  Magnet,
  Map as MapIcon,
  Maximize,
  Maximize2,
  Package,
  Ruler,
  Minus,
  Move,
  MousePointer,
  Pencil,
  Plus,
  Redo2,
  RotateCcw,
  RotateCw,
  Save,
  Search,
  Square,
  Target,
  Trash2,
  Ungroup,
  Undo2,
  Unlock,
  X,
  ZoomIn,
  ZoomOut,
} from 'lucide-react';
import { apiFetch } from '../lib/api.js';
import { loadPdfPage, renderPdfPage } from '../lib/pdfBackground.js';
import { useViewport } from '../lib/canvas/useViewport.js';
import { useGrid } from '../lib/canvas/useGrid.js';
import { useSelection } from '../lib/canvas/useSelection.js';
import { useUndoRedo } from '../lib/canvas/useUndoRedo.js';
import { findObjectAtPoint } from '../lib/canvas/hitTest.js';
import {
  componentMarkup,
  groupComponents,
  labelPrefixForComponent,
  shouldShowObjectLabel,
  viewBoxString,
} from '../lib/componentCatalog.js';
import { pluralRu, structureLabel } from '../lib/i18n.js';
import PropertiesPanel from './PropertiesPanel.jsx';
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

const STRUCT_THICKNESS = {
  wall: 4,
  boundary: 1.5,
  partition: 3,
  door: 2.5,
};

const ZONE_TYPES = [
  { id: 'kitchen',    label: 'Кухня',        color: '#fef08a' },
  { id: 'reception',  label: 'Ресепшен',     color: '#bfdbfe' },
  { id: 'chill',      label: 'Зона отдыха',  color: '#bbf7d0' },
  { id: 'focus',      label: 'Тишина',       color: '#e9d5ff' },
  { id: 'meeting',    label: 'Переговоры',   color: '#fed7aa' },
  { id: 'open_space', label: 'Опен-спейс',   color: '#e0f2fe' },
  { id: 'custom',     label: 'Другое',       color: '#f1f5f9' },
];

function zoneDefaultColor(type) {
  return ZONE_TYPES.find((z) => z.id === type)?.color || '#f1f5f9';
}

/* Minimum drag distance (SVG user-units) before we start moving desks. */
const DRAG_MIN = 3;
const VERTEX_SNAP_PX = 12;
const LINE_SNAP_PX = 10;
const OBJECT_SNAP_PX = 8;
const MIN_BOUNDARY_AREA = 100;
const CANVAS_MIN_SIZE = 200;
const CANVAS_MAX_SIZE = 8000;
const MIN_BACKGROUND_SIZE = 40;
const MIN_BACKGROUND_SCALE_PERCENT = 1;
const MAX_BACKGROUND_SCALE_PERCENT = 2000;
const METRIC_GRID_DIVISIONS = 4;
// Nice metric step values in meters (small → large)
const NICE_METRIC_STEPS = [0.05, 0.1, 0.25, 0.5, 1, 2, 5, 10, 20, 50, 100];

// Pick the smallest nice step whose pixel size is >= targetPx
function niceMetricStep(pixelsPerMeter, targetPx = 40) {
  const ppm = Math.max(0.1, pixelsPerMeter || 100);
  return NICE_METRIC_STEPS.find((m) => m * ppm >= targetPx) ?? 100;
}

const PLACE_SIZE_MODES = [
  { id: 's', label: 'S', scale: 0.75 },
  { id: 'm', label: 'M', scale: 1 },
  { id: 'l', label: 'L', scale: 1.35 },
  { id: 'custom', label: 'Custom', scale: 1 },
];

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

function rotationOf(desk) {
  return Number(desk.r ?? desk.rotation ?? 0) || 0;
}

function finiteNumber(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function firstFinite(values, fallback) {
  for (const value of values) {
    const n = finiteNumber(value);
    if (n !== null) return n;
  }
  return fallback;
}

function sameNumber(a, b) {
  const left = finiteNumber(a);
  const right = finiteNumber(b);
  return left !== null && right !== null && Math.abs(left - right) < 0.01;
}

function defaultStructThickness(type) {
  return STRUCT_THICKNESS[type] || 3;
}

function structureThickness(item, type) {
  const n = finiteNumber(item?.thick);
  return n !== null && n > 0 ? n : defaultStructThickness(type);
}

function sanitizeCanvasDim(value) {
  return String(value ?? '').replace(/[^\d]/g, '');
}

function parseCanvasDim(value) {
  const raw = sanitizeCanvasDim(value);
  if (!raw) return null;
  const n = Number(raw);
  return Number.isFinite(n) ? Math.round(n) : null;
}

function clampCanvasDim(value) {
  return Math.max(CANVAS_MIN_SIZE, Math.min(CANVAS_MAX_SIZE, value));
}

function formatNumber(value, digits = 1) {
  const n = Number(value);
  if (!Number.isFinite(n)) return '0';
  const fixed = n.toFixed(digits);
  return fixed.replace(/\.?0+$/, '');
}

function formatUnits(value) {
  const abs = Math.abs(Number(value) || 0);
  return formatNumber(value, abs >= 100 ? 0 : 1);
}

function formatMeters(value, pixelsPerMeter, digits = 2) {
  const ppm = Math.max(1, Number(pixelsPerMeter) || 100);
  return formatNumber(value / ppm, digits);
}

function distanceBetween(a, b) {
  if (!a || !b) return 0;
  return Math.hypot((b.x || 0) - (a.x || 0), (b.y || 0) - (a.y || 0));
}

function lengthOfSegments(segments) {
  return (segments || []).reduce((sum, segment) => sum + distanceBetween(segment.a, segment.b), 0);
}

function componentDefaultSize(component, fallback = { w: 100, h: 60 }) {
  return {
    w: Math.max(1, finiteNumber(component?.default_w) ?? fallback.w),
    h: Math.max(1, finiteNumber(component?.default_h) ?? fallback.h),
  };
}

function componentSizeMap(catalog) {
  const sizes = new Map();
  for (const component of catalog || []) {
    if (!component?.id) continue;
    sizes.set(component.id, componentDefaultSize(component));
  }
  return sizes;
}

function backgroundFromLayout(layoutDoc) {
  const legacyBackground = layoutDoc?.bg_url ? { image: layoutDoc.bg_url, opacity: 0.3, visible: true } : null;
  const raw = layoutDoc?.background || layoutDoc?.tracing_background || legacyBackground;
  const image = typeof raw?.image === 'string'
    ? raw.image
    : (typeof raw?.src === 'string' ? raw.src : (typeof raw?.href === 'string' ? raw.href : null));
  const opacity = finiteNumber(raw?.opacity);
  const transform = raw?.transform || layoutDoc?.bg_transform || null;
  return {
    image: image || null,
    opacity: opacity === null ? 0.3 : Math.max(0.05, Math.min(1, opacity)),
    visible: raw?.visible === false ? false : true,
    locked: raw?.locked === true,
    transform,
    calibration: raw?.calibration || null,
  };
}

function defaultBackgroundTransform(canvasW, canvasH) {
  return { x: 0, y: 0, w: Math.max(1, canvasW), h: Math.max(1, canvasH), rotation: 0 };
}

function normalizeBackgroundTransform(transform, canvasW, canvasH) {
  const fallback = defaultBackgroundTransform(canvasW, canvasH);
  if (!transform || typeof transform !== 'object') return fallback;
  const x = finiteNumber(transform.x);
  const y = finiteNumber(transform.y);
  const w = finiteNumber(transform.w);
  const h = finiteNumber(transform.h);
  const rotation = finiteNumber(transform.rotation ?? transform.r);
  if (x === null || y === null || w === null || h === null || w <= 0 || h <= 0) {
    return fallback;
  }
  return {
    x,
    y,
    w: Math.max(MIN_BACKGROUND_SIZE, w),
    h: Math.max(MIN_BACKGROUND_SIZE, h),
    rotation: rotation === null ? 0 : rotation,
  };
}

function fitBackgroundTransform(imageSize, canvasW, canvasH) {
  const iw = finiteNumber(imageSize?.w);
  const ih = finiteNumber(imageSize?.h);
  if (iw === null || ih === null || iw <= 0 || ih <= 0) {
    return defaultBackgroundTransform(canvasW, canvasH);
  }
  const scale = Math.min(canvasW / iw, canvasH / ih);
  const w = Math.max(MIN_BACKGROUND_SIZE, iw * scale);
  const h = Math.max(MIN_BACKGROUND_SIZE, ih * scale);
  return {
    x: (canvasW - w) / 2,
    y: (canvasH - h) / 2,
    w,
    h,
    rotation: 0,
  };
}

function backgroundCenter(transform) {
  return { x: transform.x + transform.w / 2, y: transform.y + transform.h / 2 };
}

function normalizeRotationDegrees(value) {
  const n = finiteNumber(value);
  if (n === null) return 0;
  const normalized = ((n % 360) + 360) % 360;
  return normalized > 180 ? normalized - 360 : normalized;
}

function scaledBackgroundTransform(transform, factor) {
  const f = finiteNumber(factor);
  if (f === null || f <= 0) return transform;
  const center = backgroundCenter(transform);
  const w = Math.max(MIN_BACKGROUND_SIZE, transform.w * f);
  const h = Math.max(MIN_BACKGROUND_SIZE, transform.h * f);
  return {
    ...transform,
    x: center.x - w / 2,
    y: center.y - h / 2,
    w,
    h,
  };
}

function backgroundScalePercent(transform, imageSize) {
  const iw = finiteNumber(imageSize?.w);
  if (iw === null || iw <= 0 || !transform?.w) return null;
  return transform.w / iw * 100;
}

function backgroundTransformForScalePercent(transform, imageSize, percent) {
  const currentPercent = backgroundScalePercent(transform, imageSize);
  const nextPercent = finiteNumber(percent);
  if (currentPercent === null || currentPercent <= 0 || nextPercent === null || nextPercent <= 0) return transform;
  const clamped = Math.max(MIN_BACKGROUND_SCALE_PERCENT, Math.min(MAX_BACKGROUND_SCALE_PERCENT, nextPercent));
  return scaledBackgroundTransform(transform, clamped / currentPercent);
}

function rotatePoint(pt, center, degrees) {
  const rad = degrees * Math.PI / 180;
  const cos = Math.cos(rad);
  const sin = Math.sin(rad);
  const dx = pt.x - center.x;
  const dy = pt.y - center.y;
  return {
    x: center.x + dx * cos - dy * sin,
    y: center.y + dx * sin + dy * cos,
  };
}

function inverseRotatePoint(pt, transform) {
  return rotatePoint(pt, backgroundCenter(transform), -(transform.rotation || 0));
}

function backgroundHandlePoints(transform) {
  const center = backgroundCenter(transform);
  const raw = {
    nw: { x: transform.x, y: transform.y },
    ne: { x: transform.x + transform.w, y: transform.y },
    sw: { x: transform.x, y: transform.y + transform.h },
    se: { x: transform.x + transform.w, y: transform.y + transform.h },
    n: { x: transform.x + transform.w / 2, y: transform.y },
    rotate: { x: transform.x + transform.w / 2, y: transform.y - Math.max(28, transform.h * 0.08) },
  };
  return Object.fromEntries(Object.entries(raw).map(([key, pt]) => [key, rotatePoint(pt, center, transform.rotation || 0)]));
}

function measureImageSize(src) {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => resolve({
      w: img.naturalWidth || img.width || 0,
      h: img.naturalHeight || img.height || 0,
    });
    img.onerror = () => resolve(null);
    img.src = src;
  });
}

function componentForDesk(desk, compMap) {
  return compMap.get(desk?.component_id || desk?.symbol_id) || compMap.get('desk-short');
}

function deskW(desk, compMap = new Map()) {
  const component = componentForDesk(desk, compMap);
  return Math.max(1, firstFinite([
    desk?.w,
    desk?.width,
    desk?.size?.w,
    desk?.size?.width,
    desk?.geometry?.w,
    desk?.geometry?.width,
    component?.default_w,
  ], 100));
}

function deskH(desk, compMap = new Map()) {
  const component = componentForDesk(desk, compMap);
  return Math.max(1, firstFinite([
    desk?.h,
    desk?.height,
    desk?.size?.h,
    desk?.size?.height,
    desk?.geometry?.h,
    desk?.geometry?.height,
    component?.default_h,
  ], 60));
}

function deskX(desk, compMap = new Map()) {
  const direct = firstFinite([
    desk?.x,
    desk?.left,
    desk?.position?.x,
    desk?.geometry?.x,
  ], null);
  if (direct !== null) return direct;
  const cx = firstFinite([desk?.cx, desk?.center_x, desk?.center?.x], null);
  return cx !== null ? cx - deskW(desk, compMap) / 2 : 0;
}

function deskY(desk, compMap = new Map()) {
  const direct = firstFinite([
    desk?.y,
    desk?.top,
    desk?.position?.y,
    desk?.geometry?.y,
  ], null);
  if (direct !== null) return direct;
  const cy = firstFinite([desk?.cy, desk?.center_y, desk?.center?.y], null);
  return cy !== null ? cy - deskH(desk, compMap) / 2 : 0;
}

function normalizeDesk(raw, index, compMap) {
  const componentId = raw?.component_id || raw?.symbol_id || '';
  const component = compMap.get(componentId) || null;
  const assetType = raw?.asset_type || raw?.space_type || component?.asset_type || 'desk';
  const nextComponentId = componentId || (assetType === 'workplace' ? 'workplace-desk-chair' : 'desk-short');
  const normalized = {
    ...(raw || {}),
    id: String(raw?.id || raw?.desk_id || raw?.workplace_id || uid(`desk-${index}`)),
    x: deskX(raw, compMap),
    y: deskY(raw, compMap),
    w: deskW(raw, compMap),
    h: deskH(raw, compMap),
    r: rotationOf(raw),
    asset_type: assetType,
    space_type: raw?.space_type || assetType,
    component_id: raw?.component_id || nextComponentId,
    symbol_id: raw?.symbol_id || nextComponentId,
    type: raw?.type || (raw?.fixed ? 'fixed' : 'flex'),
    bookable: raw?.bookable ?? (assetType === 'workplace'),
    size_mode: raw?.size_mode || raw?.component_size_mode,
    component_default_w: finiteNumber(raw?.component_default_w) ?? component?.default_w,
    component_default_h: finiteNumber(raw?.component_default_h) ?? component?.default_h,
  };
  if (assetType === 'workplace' && !normalized.workplace_id) {
    normalized.workplace_id = uid('wp');
  }
  return normalized;
}

function structuresLocked(...groups) {
  return groups.flat().some((item) => item?.locked);
}

function setStructureLockOnItems(items, locked) {
  return (items || []).map((item) => ({ ...item, locked }));
}

function boundingBoxOf(desks, ids, compMap = new Map()) {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const d of desks) {
    if (ids && !ids.has(d.id)) continue;
    const x = deskX(d, compMap), y = deskY(d, compMap), w = deskW(d, compMap), h = deskH(d, compMap);
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

function pointsFromStructure(item) {
  const pts = Array.isArray(item?.pts)
    ? item.pts
    : (Array.isArray(item?.points) ? item.points : []);
  const fromPts = pts.map(ptFromArr).filter((p) => Number.isFinite(p.x) && Number.isFinite(p.y));
  if (fromPts.length) return fromPts;

  const x1 = finiteNumber(item?.x1);
  const y1 = finiteNumber(item?.y1);
  const x2 = finiteNumber(item?.x2);
  const y2 = finiteNumber(item?.y2);
  if (x1 !== null && y1 !== null && x2 !== null && y2 !== null) {
    return [{ x: x1, y: y1 }, { x: x2, y: y2 }];
  }
  return [];
}

function collectStructureSnapPoints(...groups) {
  return groups.flatMap((items) => (items || []).flatMap(pointsFromStructure));
}

function segmentsFromPoints(points, closed = false) {
  if (!Array.isArray(points) || points.length < 2) return [];
  const segments = [];
  const limit = closed ? points.length : points.length - 1;
  for (let i = 0; i < limit; i++) {
    const a = points[i];
    const b = points[(i + 1) % points.length];
    if (Number.isFinite(a?.x) && Number.isFinite(a?.y) && Number.isFinite(b?.x) && Number.isFinite(b?.y)) {
      segments.push({ a, b });
    }
  }
  return segments;
}

function segmentsFromStructure(item, closed = false) {
  return segmentsFromPoints(pointsFromStructure(item), closed || !!item?.closed);
}

function closestPointOnSegment(point, a, b) {
  const abx = b.x - a.x;
  const aby = b.y - a.y;
  const den = abx * abx + aby * aby;
  if (den <= 1e-9) return { x: a.x, y: a.y };
  const t = Math.max(0, Math.min(1, ((point.x - a.x) * abx + (point.y - a.y) * aby) / den));
  return { x: a.x + abx * t, y: a.y + aby * t };
}

function orthogonalPoint(from, point) {
  if (!from) return point;
  const dx = point.x - from.x;
  const dy = point.y - from.y;
  return Math.abs(dx) >= Math.abs(dy)
    ? { x: point.x, y: from.y }
    : { x: from.x, y: point.y };
}

function polygonArea(points) {
  if (!Array.isArray(points) || points.length < 3) return 0;
  let area = 0;
  for (let i = 0; i < points.length; i++) {
    const a = points[i];
    const b = points[(i + 1) % points.length];
    area += a.x * b.y - b.x * a.y;
  }
  return Math.abs(area) / 2;
}

function orientation(a, b, c) {
  return (b.y - a.y) * (c.x - b.x) - (b.x - a.x) * (c.y - b.y);
}

function onSegment(a, b, c) {
  return Math.min(a.x, c.x) <= b.x && b.x <= Math.max(a.x, c.x) &&
    Math.min(a.y, c.y) <= b.y && b.y <= Math.max(a.y, c.y);
}

function segmentsIntersect(a, b, c, d) {
  const o1 = orientation(a, b, c);
  const o2 = orientation(a, b, d);
  const o3 = orientation(c, d, a);
  const o4 = orientation(c, d, b);
  if ((o1 > 0) !== (o2 > 0) && (o3 > 0) !== (o4 > 0)) return true;
  if (Math.abs(o1) < 1e-9 && onSegment(a, c, b)) return true;
  if (Math.abs(o2) < 1e-9 && onSegment(a, d, b)) return true;
  if (Math.abs(o3) < 1e-9 && onSegment(c, a, d)) return true;
  if (Math.abs(o4) < 1e-9 && onSegment(c, b, d)) return true;
  return false;
}

function hasSelfIntersection(points, closed = false) {
  const segments = segmentsFromPoints(points, closed);
  for (let i = 0; i < segments.length; i++) {
    for (let j = i + 1; j < segments.length; j++) {
      const adjacent = Math.abs(i - j) === 1 || (closed && i === 0 && j === segments.length - 1);
      if (adjacent) continue;
      if (segmentsIntersect(segments[i].a, segments[i].b, segments[j].a, segments[j].b)) return true;
    }
  }
  return false;
}

function drawValidationIssue(type, points, previewPoint = null) {
  if (type !== 'boundary' && type !== 'zone') return null;
  const allPoints = previewPoint ? [...points, previewPoint] : points;
  if (allPoints.length < 3) return { level: 'info', text: 'Нужно минимум 3 точки' };
  if (polygonArea(allPoints) < MIN_BOUNDARY_AREA) return { level: 'warning', text: 'Зона слишком маленькая' };
  if (hasSelfIntersection(allPoints, true)) return { level: 'error', text: 'Контур пересекает сам себя' };
  return { level: 'ok', text: 'Контур валиден' };
}

function collectDeskSnapAxes(desks, excludedIds, compMap, structurePoints = []) {
  const axes = { x: [], y: [] };
  for (const desk of desks || []) {
    if (excludedIds?.has(desk.id)) continue;
    const x = deskX(desk, compMap);
    const y = deskY(desk, compMap);
    const w = deskW(desk, compMap);
    const h = deskH(desk, compMap);
    axes.x.push(x, x + w / 2, x + w);
    axes.y.push(y, y + h / 2, y + h);
  }
  for (const point of structurePoints || []) {
    axes.x.push(point.x);
    axes.y.push(point.y);
  }
  return axes;
}

function bestAxisSnap(values, targets, tolerance) {
  let best = null;
  for (const value of values) {
    for (const target of targets) {
      const diff = target - value;
      if (Math.abs(diff) <= tolerance && (!best || Math.abs(diff) < Math.abs(best.diff))) {
        best = { diff, target };
      }
    }
  }
  return best;
}

/* ── Minimap ── */

function Minimap({ canvasW, canvasH, vb, desks, walls, boundaries, onPanTo }) {
  const MINI_W = 160;
  const MINI_H = Math.round(MINI_W * (canvasH / canvasW)) || 100;
  const scale = MINI_W / canvasW;

  const vpX = vb.x * scale;
  const vpY = vb.y * scale;
  const vpW = vb.w * scale;
  const vpH = vb.h * scale;

  const handleClick = (e) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const mx = (e.clientX - rect.left) / scale;
    const my = (e.clientY - rect.top) / scale;
    onPanTo(mx, my);
  };

  return (
    <div className="ce-minimap" onClick={handleClick}>
      <svg width={MINI_W} height={MINI_H} viewBox={`0 0 ${canvasW} ${canvasH}`}>
        <rect width={canvasW} height={canvasH} fill="#f1f5f9" />
        {walls.map((w) => {
          const pts = (w.pts || w.points || []).map(ptFromArr);
          return pts.length >= 2 ? <polyline key={w.id} points={pts.map((p) => `${p.x},${p.y}`).join(' ')} fill="none" stroke="#64748b" strokeWidth={4} /> : null;
        })}
        {boundaries.map((b) => {
          const pts = (b.pts || b.points || []).map(ptFromArr);
          return pts.length >= 2 ? <polygon key={b.id} points={pts.map((p) => `${p.x},${p.y}`).join(' ')} fill="none" stroke="#94a3b8" strokeWidth={3} /> : null;
        })}
        {desks.map((d) => (
          <rect key={d.id} x={d.x} y={d.y} width={d.w || 100} height={d.h || 60} fill="#93c5fd" stroke="#2563eb" strokeWidth={2} rx={4} />
        ))}
        <rect x={vb.x} y={vb.y} width={vb.w} height={vb.h} fill="rgba(37,99,235,0.08)" stroke="#2563eb" strokeWidth={Math.max(4, 2 / scale)} rx={2} />
      </svg>
    </div>
  );
}

/* ── Hotkey badge helper ── */

function KBD({ children }) {
  return <kbd className="ce-kbd">{children}</kbd>;
}

/* ── PpmInlineEdit — inline editable pixels-per-meter indicator ── */
function PpmInlineEdit({ value, onChange }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(String(value));
  const inputRef = useRef(null);

  function commit() {
    const raw = Number(draft);
    if (!Number.isFinite(raw) || raw <= 0) {
      setEditing(false);
      return;
    }
    const n = Math.max(10, Math.min(2000, Math.round(raw)));
    if (Number.isFinite(n) && n !== value) onChange(n);
    setEditing(false);
  }

  useEffect(() => {
    if (editing) { setDraft(String(value)); inputRef.current?.select(); }
  }, [editing]); // eslint-disable-line

  if (editing) {
    return (
      <input
        ref={inputRef}
        type="number"
        className="ce-ppm-input"
        value={draft}
        min={10}
        max={2000}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === 'Enter') commit();
          if (e.key === 'Escape') setEditing(false);
        }}
        style={{ width: 52, fontSize: 11 }}
      />
    );
  }
  return (
    <span
      className="ce-ppm-display"
      onClick={() => setEditing(true)}
      title="1 метр в единицах холста — кликни чтобы изменить"
    >
      1 м = {value} ед.
    </span>
  );
}

/* ── component ── */

const CanvasEditor = forwardRef(function CanvasEditor({
  layout,
  floorId,
  components,
  onLayoutChange,
  onDirtyChange,
  onNotice,
  onError,
}, ref) {
  /* ── canvas dimensions — from layout.vb or overridden via resize UI ── */
  const [canvasSizeOverride, setCanvasSizeOverride] = useState(null); // {w, h} or null
  const [canvasResizeOpen, setCanvasResizeOpen] = useState(false);
  const [canvasResizeInput, setCanvasResizeInput] = useState({ w: 1200, h: 800 });

  const canvasW = useMemo(() => {
    if (canvasSizeOverride) return canvasSizeOverride.w;
    const vb = layout?.layout?.vb;
    return (Array.isArray(vb) ? vb[2] : null) || layout?.layout?.canvas_width || 1200;
  }, [layout, canvasSizeOverride]);
  const canvasH = useMemo(() => {
    if (canvasSizeOverride) return canvasSizeOverride.h;
    const vb = layout?.layout?.vb;
    return (Array.isArray(vb) ? vb[3] : null) || layout?.layout?.canvas_height || 800;
  }, [layout, canvasSizeOverride]);

  /* ── scale: pixels per meter ── */
  const [pixelsPerMeter, setPixelsPerMeter] = useState(
    () => layout?.layout?.pixels_per_meter || 100
  );

  /* ── hooks ── */
  const viewport = useViewport({ contentW: canvasW, contentH: canvasH });
  // Adaptive grid: pick smallest nice metric step whose pixel size is visually comfortable,
  // also accounting for current viewport zoom so the grid stays useful at any zoom level.
  const metricGridStep = useMemo(() => {
    const ppm = Math.max(0.1, Number(pixelsPerMeter) || 100);
    const zoom = viewport.zoom || 1;
    const stepM = niceMetricStep(ppm * zoom);
    return Math.max(1, stepM * ppm);
  }, [pixelsPerMeter, viewport.zoom]);
  const grid = useGrid({ defaultSize: metricGridStep, defaultSnap: false, defaultVisible: true });

  useEffect(() => {
    grid.setGridSize(metricGridStep);
  }, [grid.setGridSize, metricGridStep]);

  /* ── tool mode: 'select' | 'pan' | 'place' | 'measure' | 'draw_wall' | 'draw_boundary' | 'draw_partition' | 'draw_door' | 'draw_zone' | 'draw_infra' ── */
  const [tool, setTool] = useState('select');
  const [placeComponentId, setPlaceComponentId] = useState('workplace-desk-chair');

  /* ── drawing state for structure polylines ── */
  const [drawPoints, setDrawPoints] = useState([]);
  const [drawPreviewPt, setDrawPreviewPt] = useState(null);
  const [drawSnapPt, setDrawSnapPt] = useState(null);
  const [measurePoints, setMeasurePoints] = useState([]);
  const [measurePreviewPt, setMeasurePreviewPt] = useState(null);

  /* ── selected structure element { type, id } or null ── */
  const [selectedStruct, setSelectedStruct] = useState(null);

  /* ── selected zone id or null ── */
  const [selectedZoneId, setSelectedZoneId] = useState(null);

  /* ── draw mode helpers (must be before keyboard effect) ── */
  const isDrawMode = tool.startsWith('draw_');
  const drawStructType = isDrawMode ? tool.replace('draw_', '') : null;
  const isZoneDrawMode = tool === 'draw_zone';
  const isInfraDrawMode = tool === 'draw_infra';

  /* ── local data state ── */
  const [desks, setDesks] = useState([]);
  const [walls, setWalls] = useState([]);
  const [boundaries, setBoundaries] = useState([]);
  const [partitions, setPartitions] = useState([]);
  const [doors, setDoors] = useState([]);
  const [groups, setGroups] = useState([]);
  const [zones, setZones] = useState([]);
  const [infraLayers, setInfraLayers] = useState([]); // [{id, name, color, visible, items:[{id,pts}]}]
  const [activeInfraLayerId, setActiveInfraLayerId] = useState(null);
  const [selectedInfraItem, setSelectedInfraItem] = useState(null); // {layerId, itemId}
  const [kbdPanelOpen, setKbdPanelOpen] = useState(false);
  const [dirty, setDirty] = useState(false);

  /* ── selection ── */
  const sel = useSelection();
  const [propertiesCollapsed, setPropertiesCollapsed] = useState(true);
  const previousDeskSelectionCountRef = useRef(0);

  /* ── undo / redo ── */
  const undoRedo = useUndoRedo({
    enabled: false,
    onRestore: useCallback((snapshot) => {
      setDesks(snapshot.desks || []);
      if (snapshot.walls) setWalls(snapshot.walls);
      if (snapshot.boundaries) setBoundaries(snapshot.boundaries);
      if (snapshot.partitions) setPartitions(snapshot.partitions);
      if (snapshot.doors) setDoors(snapshot.doors);
      if (snapshot.groups) setGroups(snapshot.groups);
      if (snapshot.zones) setZones(snapshot.zones);
      if (snapshot.infraLayers) setInfraLayers(snapshot.infraLayers);
      if (snapshot.background) {
        setBgImage(snapshot.background.image || null);
        setBgOpacity(snapshot.background.opacity ?? 0.3);
        setBgVisible(snapshot.background.visible !== false);
        setBgLocked(snapshot.background.locked === true);
        setBgTransform(normalizeBackgroundTransform(snapshot.background.transform, canvasW, canvasH));
        setBgCalibration(snapshot.background.calibration || null);
        setBgCalibrationPoints([]);
        setBgCalibrationInput('');
      }
      setStructureLocked(
        snapshot.structureLocked ??
          structuresLocked(snapshot.walls || [], snapshot.boundaries || [], snapshot.partitions || [], snapshot.doors || []),
      );
      sel.clearSelection();
      setSelectedStruct(null);
      setDirty(true);
    }, [sel, canvasW, canvasH]),
  });

  /* ── drag state (ref — does not need re-render) ── */
  const dragRef = useRef(null);
  // { startSvgPt, origins: Map<id, {x,y}>, moved: boolean }

  /* ── resize drag state ── */
  const resizeRef = useRef(null);
  // { deskId, corner: 0-3, startPt, origX, origY, origW, origH }

  /* ── rotation drag state ── */
  const rotateRef = useRef(null);
  // { deskId, center, startAngle, origR }

  /* ── background image drag state ── */
  const bgDragRef = useRef(null);
  // { action, startPt, origTransform, corner }

  /* ── vertex drag state for structure points ── */
  const vertexDragRef = useRef(null);
  // { type: 'wall'|'partition'|..., id, pointIndex, startPt }

  /* ── clipboard for copy/paste ── */
  const clipboardRef = useRef(null);

  /* ── space-key panning ── */
  const spaceRef = useRef(false);
  const isPanningRef = useRef(false);

  /* ── cursor SVG position for status bar ── */
  const [cursorSvgPt, setCursorSvgPt] = useState({ x: 0, y: 0 });

  /* ── saving ── */
  const [saving, setSaving] = useState(false);
  const savingRef = useRef(false);

  /* ── layers visibility ── */
  const [layerVis, setLayerVis] = useState({
    walls: true,
    boundaries: true,
    partitions: true,
    doors: true,
    desks: true,
    groups: true,
    zones: true,
  });
  const [structureLocked, setStructureLocked] = useState(false);
  const [desksLocked, setDesksLocked] = useState(false);
  const [layerPanelOpen, setLayerPanelOpen] = useState(false);
  const toggleLayer = (key) => setLayerVis((prev) => ({ ...prev, [key]: !prev[key] }));
  const [objectSnapGuides, setObjectSnapGuides] = useState(null);

  /* ── background tracing image ── */
  const [bgImage, setBgImage] = useState(null);       // data URL or null
  const [bgOpacity, setBgOpacity] = useState(0.3);    // 0–1
  const [bgVisible, setBgVisible] = useState(true);
  const [bgLocked, setBgLocked] = useState(false);
  const [bgTransform, setBgTransform] = useState(() => defaultBackgroundTransform(canvasW, canvasH));
  const [bgCalibration, setBgCalibration] = useState(null);
  const [bgCalibrationPoints, setBgCalibrationPoints] = useState([]);
  const [bgCalibrationInput, setBgCalibrationInput] = useState('');
  const [bgNaturalSize, setBgNaturalSize] = useState(null);
  const [bgPdfData, setBgPdfData] = useState(null);   // Uint8Array for page switching
  const [bgPdfPages, setBgPdfPages] = useState(0);    // total pages in loaded PDF
  const [bgPdfPage, setBgPdfPage] = useState(1);      // current page (1-indexed)
  const [bgPdfLoading, setBgPdfLoading] = useState(false);
  const bgFileRef = useRef(null);
  const toolbarTipTargetRef = useRef(null);
  const [toolbarTip, setToolbarTip] = useState(null);

  useEffect(() => {
    let cancelled = false;
    if (!bgImage) {
      setBgNaturalSize(null);
      return undefined;
    }
    measureImageSize(bgImage).then((size) => {
      if (!cancelled) setBgNaturalSize(size);
    });
    return () => { cancelled = true; };
  }, [bgImage]);

  useEffect(() => {
    if (tool !== 'measure') setMeasurePreviewPt(null);
  }, [tool]);

  async function applyLoadedBackground(dataUrl, { pdfData = null, totalPages = 0, page = 1 } = {}) {
    const imageSize = await measureImageSize(dataUrl);
    undoRedo.push(snapshot());
    setBgPdfData(pdfData);
    setBgPdfPages(totalPages);
    setBgPdfPage(page);
    setBgImage(dataUrl);
    setBgNaturalSize(imageSize);
    setBgTransform(fitBackgroundTransform(imageSize, canvasW, canvasH));
    setBgLocked(false);
    setBgCalibration(null);
    setBgCalibrationPoints([]);
    setBgCalibrationInput('');
    setBgVisible(true);
    setDirty(true);
  }

  function onBgFileChange(e) {
    const file = e.target.files?.[0];
    if (!file) return;
    e.target.value = '';

    if (file.type === 'application/pdf') {
      setBgPdfLoading(true);
      loadPdfPage(file, 1)
        .then(({ dataUrl, totalPages, pdfData }) => applyLoadedBackground(dataUrl, { pdfData, totalPages, page: 1 }))
        .catch((err) => onError?.(`PDF: ${err.message}`))
        .finally(() => setBgPdfLoading(false));
      return;
    }

    // Regular image (PNG / JPEG / WebP / SVG)
    const reader = new FileReader();
    reader.onload = (ev) => {
      applyLoadedBackground(ev.target.result, { pdfData: null, totalPages: 0, page: 1 })
        .catch((err) => onError?.(`Фон: ${err.message}`));
    };
    reader.readAsDataURL(file);
  }

  function navigatePdfPage(delta) {
    const next = bgPdfPage + delta;
    if (next < 1 || next > bgPdfPages || !bgPdfData || bgPdfLoading) return;
    setBgPdfLoading(true);
    renderPdfPage(bgPdfData, next)
      .then((dataUrl) => {
        setBgPdfPage(next);
        setBgImage(dataUrl);
        setDirty(true);
      })
      .catch((err) => onError?.(`PDF: ${err.message}`))
      .finally(() => setBgPdfLoading(false));
  }

  function fitBackgroundToCanvas() {
    if (!bgImage) return;
    undoRedo.push(snapshot());
    setBgTransform(fitBackgroundTransform(bgNaturalSize, canvasW, canvasH));
    setBgCalibration(null);
    setBgCalibrationPoints([]);
    setBgCalibrationInput('');
    setDirty(true);
  }

  function commitBackgroundTransform(nextTransform) {
    if (!bgImage || bgLocked) return;
    undoRedo.push(snapshot());
    setBgTransform(nextTransform);
    setTool('bg_edit');
    setDirty(true);
  }

  function zoomBackgroundBy(factor) {
    const orig = normalizeBackgroundTransform(bgTransform, canvasW, canvasH);
    commitBackgroundTransform(scaledBackgroundTransform(orig, factor));
  }

  function rotateBackgroundBy(delta) {
    const orig = normalizeBackgroundTransform(bgTransform, canvasW, canvasH);
    commitBackgroundTransform({
      ...orig,
      rotation: normalizeRotationDegrees((orig.rotation || 0) + delta),
    });
  }

  function applyBackgroundScalePercent(rawValue) {
    const percent = Number(rawValue);
    if (!Number.isFinite(percent) || percent <= 0) {
      onError?.('Масштаб подложки должен быть больше 0%');
      return;
    }
    const orig = normalizeBackgroundTransform(bgTransform, canvasW, canvasH);
    const next = backgroundTransformForScalePercent(orig, bgNaturalSize, percent);
    commitBackgroundTransform(next);
  }

  function applyBackgroundRotation(rawValue) {
    const rotation = Number(rawValue);
    if (!Number.isFinite(rotation)) {
      onError?.('Поворот подложки должен быть числом');
      return;
    }
    const orig = normalizeBackgroundTransform(bgTransform, canvasW, canvasH);
    commitBackgroundTransform({ ...orig, rotation: normalizeRotationDegrees(rotation) });
  }

  function toggleBackgroundLock() {
    if (!bgImage) return;
    undoRedo.push(snapshot());
    const nextLocked = !bgLocked;
    setBgLocked(nextLocked);
    if (nextLocked && tool === 'bg_edit') setTool('select');
    setDirty(true);
  }

  function startBackgroundCalibration() {
    if (!bgImage) return;
    cancelDraw();
    sel.clearSelection();
    setSelectedStruct(null);
    setSelectedZoneId(null);
    setSelectedInfraItem(null);
    setBgCalibrationPoints([]);
    setBgCalibrationInput('');
    setTool(tool === 'bg_calibrate' ? 'select' : 'bg_calibrate');
  }

  function confirmBackgroundCalibration() {
    if (bgCalibrationPoints.length !== 2) return;
    const distanceM = Number(bgCalibrationInput);
    if (!Number.isFinite(distanceM) || distanceM <= 0) {
      onError?.('Введите расстояние в метрах больше 0');
      return;
    }
    const [a, b] = bgCalibrationPoints;
    const distancePx = Math.hypot(b.x - a.x, b.y - a.y);
    if (!Number.isFinite(distancePx) || distancePx <= 0) {
      onError?.('Точки калибровки должны быть разными');
      return;
    }
    const nextPpm = Math.max(10, Math.min(2000, Math.round(distancePx / distanceM)));
    undoRedo.push(snapshot());
    setPixelsPerMeter(nextPpm);
    setBgCalibration({
      distance_m: distanceM,
      points: bgCalibrationPoints.map((p) => [p.x, p.y]),
    });
    setBgLocked(true);
    setBgCalibrationPoints([]);
    setBgCalibrationInput('');
    setTool('select');
    setDirty(true);
    onNotice?.(`Масштаб: 1м=${nextPpm}px`);
  }

  function cancelBackgroundCalibration() {
    setBgCalibrationPoints([]);
    setBgCalibrationInput('');
    if (tool === 'bg_calibrate') setTool('select');
  }

  function restoreTooltipTitle(node) {
    if (!node?.dataset?.ceTitle) return;
    node.setAttribute('title', node.dataset.ceTitle);
    delete node.dataset.ceTitle;
  }

  const hideToolbarTip = useCallback(() => {
    restoreTooltipTitle(toolbarTipTargetRef.current);
    toolbarTipTargetRef.current = null;
    setToolbarTip(null);
  }, []);

  const showToolbarTip = useCallback((event) => {
    const target = event.target?.closest?.('[title],[data-ce-title]');
    if (!target || !event.currentTarget.contains(target) || target === event.currentTarget) return;
    if (target.disabled) return;

    if (toolbarTipTargetRef.current && toolbarTipTargetRef.current !== target) {
      restoreTooltipTitle(toolbarTipTargetRef.current);
    }

    const text = target.getAttribute('title') || target.dataset.ceTitle || '';
    if (!text.trim()) return;
    if (target.getAttribute('title')) {
      target.dataset.ceTitle = text;
      target.removeAttribute('title');
    }

    const rect = target.getBoundingClientRect();
    const belowY = rect.bottom + 8;
    const aboveY = rect.top - 8;
    const placement = belowY + 34 < window.innerHeight ? 'below' : 'above';
    const halfMax = Math.min(130, Math.max(12, window.innerWidth / 2 - 12));
    toolbarTipTargetRef.current = target;
    setToolbarTip({
      text,
      x: Math.min(Math.max(rect.left + rect.width / 2, halfMax), window.innerWidth - halfMax),
      y: placement === 'below' ? belowY : aboveY,
      placement,
    });
  }, []);

  const onToolbarPointerOut = useCallback((event) => {
    const current = toolbarTipTargetRef.current;
    if (!current) return;
    if (event.relatedTarget && current.contains(event.relatedTarget)) return;
    hideToolbarTip();
  }, [hideToolbarTip]);

  /* ── placement palette ── */
  const [placeSizeMode, setPlaceSizeMode] = useState('m');
  const [placeCustomSize, setPlaceCustomSize] = useState({ w: 140, h: 125 });

  /* ── search ── */
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const searchResults = useMemo(() => {
    if (!searchQuery.trim()) return [];
    const q = searchQuery.trim().toLowerCase();
    return desks.filter((d) =>
      (d.label || d.id || '').toLowerCase().includes(q) ||
      (d.assigned_to || '').toLowerCase().includes(q)
    );
  }, [desks, searchQuery]);
  const autoSaveRef = useRef(null);

  /* ── component size lookup ── */
  // components prop is already merged (builtins + DB overrides) from main.jsx —
  // do NOT call mergeComponentCatalog again or builtins will overwrite DB changes.
  const componentCatalog = components;
  const componentGroups = useMemo(() => groupComponents(componentCatalog), [componentCatalog]);
  const componentSizeRef = useRef(new Map());
  const compMap = useMemo(() => {
    const m = new Map();
    for (const c of componentCatalog) m.set(c.id, c);
    if (!m.has('desk-short'))           m.set('desk-short', { id: 'desk-short', default_w: 100, default_h: 60 });
    if (!m.has('workplace-desk-chair')) m.set('workplace-desk-chair', { id: 'workplace-desk-chair', default_w: 140, default_h: 125 });
    return m;
  }, [componentCatalog]);

  const selectedPlaceComponent = compMap.get(placeComponentId) || componentCatalog[0] || compMap.get('desk-short');
  const selectedPlaceSize = useMemo(() => {
    const baseW = selectedPlaceComponent?.default_w || 100;
    const baseH = selectedPlaceComponent?.default_h || 60;
    if (placeSizeMode === 'custom') {
      return {
        w: Math.max(10, Number(placeCustomSize.w) || baseW),
        h: Math.max(10, Number(placeCustomSize.h) || baseH),
      };
    }
    const preset = PLACE_SIZE_MODES.find((item) => item.id === placeSizeMode) || PLACE_SIZE_MODES[1];
    return { w: Math.round(baseW * preset.scale), h: Math.round(baseH * preset.scale) };
  }, [placeCustomSize.h, placeCustomSize.w, placeSizeMode, selectedPlaceComponent]);

  useEffect(() => {
    if (!componentCatalog.length) return;
    if (!componentCatalog.some((c) => c.id === placeComponentId)) {
      setPlaceComponentId(componentCatalog[0].id);
      setPlaceCustomSize({
        w: componentCatalog[0].default_w || 100,
        h: componentCatalog[0].default_h || 60,
      });
    }
  }, [componentCatalog, placeComponentId]);

  function selectPlaceComponent(component) {
    setPlaceComponentId(component.id);
    setPlaceCustomSize({
      w: component.default_w || 100,
      h: component.default_h || 60,
    });
  }

  function snapshot() {
    return {
      desks,
      walls,
      boundaries,
      partitions,
      doors,
      groups,
      zones,
      infraLayers,
      structureLocked,
      background: {
        image: bgImage,
        opacity: bgOpacity,
        visible: bgVisible,
        locked: bgLocked,
        transform: bgTransform,
        calibration: bgCalibration,
      },
    };
  }

  const visibleWalls = layerVis.walls ? walls : [];
  const visibleBoundaries = layerVis.boundaries ? boundaries : [];
  const visiblePartitions = layerVis.partitions ? partitions : [];
  const visibleDoors = layerVis.doors ? doors : [];

  const structureSnapPoints = useMemo(
    () => collectStructureSnapPoints(visibleWalls, visibleBoundaries, visiblePartitions, visibleDoors),
    [visibleWalls, visibleBoundaries, visiblePartitions, visibleDoors],
  );

  const structureSnapSegments = useMemo(() => [
    ...visibleWalls.flatMap((item) => segmentsFromStructure(item)),
    ...visibleBoundaries.flatMap((item) => segmentsFromStructure(item, true)),
    ...visiblePartitions.flatMap((item) => segmentsFromStructure(item)),
    ...visibleDoors.flatMap((item) => segmentsFromStructure(item)),
  ], [visibleWalls, visibleBoundaries, visiblePartitions, visibleDoors]);

  const resolveDrawPoint = useCallback((rawPt, event) => {
    const vertexTolerance = viewport.worldUnitsForPx(VERTEX_SNAP_PX);
    const lineTolerance = viewport.worldUnitsForPx(LINE_SNAP_PX);
    const candidates = [
      ...drawPoints.slice(0, Math.max(0, drawPoints.length - 1)),
      ...structureSnapPoints,
    ];
    let best = null;
    let bestDist = Infinity;
    for (const candidate of candidates) {
      const dist = Math.hypot(rawPt.x - candidate.x, rawPt.y - candidate.y);
      if (dist < bestDist) {
        best = candidate;
        bestDist = dist;
      }
    }
    if (best && bestDist <= vertexTolerance) {
      const point = { x: best.x, y: best.y };
      return { point, snapPoint: point, snapKind: 'vertex' };
    }

    let bestLine = null;
    let bestLineDist = Infinity;
    for (const segment of structureSnapSegments) {
      const point = closestPointOnSegment(rawPt, segment.a, segment.b);
      const dist = Math.hypot(rawPt.x - point.x, rawPt.y - point.y);
      if (dist < bestLineDist) {
        bestLine = point;
        bestLineDist = dist;
      }
    }
    if (bestLine && bestLineDist <= lineTolerance) {
      const point = event?.shiftKey && drawPoints.length
        ? orthogonalPoint(drawPoints[drawPoints.length - 1], bestLine)
        : bestLine;
      return { point, snapPoint: bestLine, snapKind: 'line' };
    }

    const snapped = grid.snapPoint(rawPt, {
      altSnapOff: event?.altKey,
      shiftFine: false,
    });
    const point = event?.shiftKey && drawPoints.length
      ? orthogonalPoint(drawPoints[drawPoints.length - 1], snapped)
      : snapped;
    return {
      point,
      snapPoint: null,
      snapKind: null,
    };
  }, [drawPoints, grid, structureSnapPoints, structureSnapSegments, viewport]);

  /* ── sync layout → local state ── */
  useEffect(() => {
    const nextDesks = (layout?.layout?.desks || []).map((desk, index) => normalizeDesk(desk, index, compMap));
    const nextWalls = layout?.layout?.walls || [];
    const nextBoundaries = layout?.layout?.boundaries || [];
    const nextPartitions = layout?.layout?.partitions || [];
    const nextDoors = layout?.layout?.doors || [];
    setDesks(nextDesks);
    setWalls(nextWalls);
    setBoundaries(nextBoundaries);
    setPartitions(nextPartitions);
    setDoors(nextDoors);
    setGroups(layout?.layout?.groups || []);
    setZones(layout?.layout?.zones || []);
    setInfraLayers(layout?.layout?.infra_layers || []);
    setCanvasSizeOverride(null); // clear override — use layout vb
    setPixelsPerMeter(layout?.layout?.pixels_per_meter || 100);
    const nextBackground = backgroundFromLayout(layout?.layout);
    setBgImage(nextBackground.image);
    setBgOpacity(nextBackground.opacity);
    setBgVisible(nextBackground.visible);
    setBgLocked(nextBackground.locked);
    setBgTransform(normalizeBackgroundTransform(nextBackground.transform, canvasW, canvasH));
    setBgCalibration(nextBackground.calibration);
    setBgCalibrationPoints([]);
    setBgCalibrationInput('');
    setStructureLocked(structuresLocked(nextWalls, nextBoundaries, nextPartitions, nextDoors));
    sel.clearSelection();
    setDirty(false);
    setDrawPoints([]);
    setDrawPreviewPt(null);
    setDrawSnapPt(null);
    setMeasurePoints([]);
    setMeasurePreviewPt(null);
    setObjectSnapGuides(null);
    setSelectedStruct(null);
    undoRedo.clear();
    setTimeout(() => viewport.zoomToFit({ x: 0, y: 0, w: canvasW, h: canvasH }, 60), 0);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [layout]);

  useEffect(() => {
    const nextSizes = componentSizeMap(componentCatalog);
    const prevSizes = componentSizeRef.current;
    componentSizeRef.current = nextSizes;
    if (!prevSizes.size) return;

    setDesks((prevDesks) => {
      let changed = false;
      const nextDesks = prevDesks.map((desk) => {
        const componentId = desk.component_id || desk.symbol_id;
        const prevSize = prevSizes.get(componentId);
        const nextSize = nextSizes.get(componentId);
        if (!prevSize || !nextSize) return desk;
        if (sameNumber(prevSize.w, nextSize.w) && sameNumber(prevSize.h, nextSize.h)) return desk;

        const currentW = firstFinite([desk?.w, desk?.width, desk?.size?.w, desk?.size?.width, desk?.geometry?.w, desk?.geometry?.width], prevSize.w);
        const currentH = firstFinite([desk?.h, desk?.height, desk?.size?.h, desk?.size?.height, desk?.geometry?.h, desk?.geometry?.height], prevSize.h);
        const followsComponentSize =
          desk.size_mode === 'component' ||
          desk.component_size_mode === 'component' ||
          desk.use_component_size === true ||
          (
            desk.size_mode !== 'custom' &&
            desk.component_size_mode !== 'custom' &&
            sameNumber(currentW, prevSize.w) &&
            sameNumber(currentH, prevSize.h)
          );

        if (!followsComponentSize) return desk;
        changed = true;
        return {
          ...desk,
          w: nextSize.w,
          h: nextSize.h,
          size_mode: 'component',
          component_default_w: nextSize.w,
          component_default_h: nextSize.h,
        };
      });
      if (changed) {
        setDirty(true);
        return nextDesks;
      }
      return prevDesks;
    });
  }, [componentCatalog]);

  useEffect(() => {
    onDirtyChange?.(dirty);
  }, [dirty, onDirtyChange]);

  useEffect(() => {
    const count = sel.selectedIds.size;
    if (count === 0) {
      setPropertiesCollapsed(true);
    } else if (previousDeskSelectionCountRef.current === 0) {
      setPropertiesCollapsed(false);
    }
    previousDeskSelectionCountRef.current = count;
  }, [sel.selectedIds.size]);

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
        if (tool === 'measure') {
          if (measurePoints.length > 0) {
            setMeasurePoints([]);
            setMeasurePreviewPt(null);
          } else {
            setTool('select');
          }
          return;
        }
        if (tool === 'bg_calibrate' || tool === 'bg_edit') {
          cancelBackgroundCalibration();
          setTool('select');
          return;
        }
        if (drawPoints.length > 0) { cancelDraw(); return; }
        sel.clearSelection();
        setSelectedStruct(null);
        dragRef.current = null;
        if (tool === 'place' || isDrawMode) setTool('select');
        return;
      }

      if (e.key === 'Enter' && (isZoneDrawMode ? drawPoints.length >= 3 : drawPoints.length >= 2)) {
        e.preventDefault();
        finishDraw();
        return;
      }

      if (e.key === 'v' && !inInput && !meta) { cancelDraw(); setTool('select'); return; }
      if (e.key === 'p' && !inInput && !meta) { cancelDraw(); setTool('place'); return; }
      if (e.key === 'm' && !inInput && !meta) { cancelDraw(); setTool((prev) => (prev === 'measure' ? 'select' : 'measure')); return; }
      if (e.key === 'w' && !inInput && !meta && !structureLocked) { cancelDraw(); setTool('draw_wall'); return; }
      if (e.key === 'z' && !inInput && !meta) { cancelDraw(); setTool('draw_zone'); return; }
      if (e.key === 'i' && !inInput && !meta) {
        if (activeInfraLayerId) { cancelDraw(); setTool((prev) => (prev === 'draw_infra' ? 'select' : 'draw_infra')); }
        return;
      }
      if (e.key === 'f' && !inInput && !meta) { handleZoomToFit(); return; }
      if (e.key === 'l' && !inInput && !meta) { setDesksLocked((prev) => !prev); return; }
      if (e.key === '?' && !inInput) { setKbdPanelOpen((prev) => !prev); return; }

      if ((e.key === 'Delete' || e.key === 'Backspace') && !inInput) {
        if (sel.selectedIds.size) {
          e.preventDefault();
          deleteSelected();
          return;
        }
        if (selectedStruct && !structureLocked) {
          e.preventDefault();
          deleteSelectedStruct();
          return;
        }
        if (selectedZoneId) {
          e.preventDefault();
          deleteZone(selectedZoneId);
          return;
        }
        if (selectedInfraItem) {
          e.preventDefault();
          undoRedo.push(snapshot());
          setInfraLayers((prev) => prev.map((l) =>
            l.id === selectedInfraItem.layerId
              ? { ...l, items: l.items.filter((i) => i.id !== selectedInfraItem.itemId) }
              : l
          ));
          setSelectedInfraItem(null);
          setDirty(true);
          return;
        }
      }

      // Search
      if (meta && e.key === 'f') {
        e.preventDefault();
        setSearchOpen((prev) => !prev);
        setSearchQuery('');
        return;
      }

      // Copy
      if (meta && e.key === 'c' && !inInput && sel.selectedIds.size) {
        e.preventDefault();
        clipboardRef.current = desks.filter((d) => sel.selectedIds.has(d.id)).map((d) => ({ ...d }));
        onNotice(`Скопировано: ${clipboardRef.current.length}`);
        return;
      }

      // Paste
      if (meta && e.key === 'v' && !inInput && clipboardRef.current?.length) {
        e.preventDefault();
        const offset = 20;
        const pasted = clipboardRef.current.map((d) => ({
          ...d,
          id: uid('desk'),
          x: deskX(d, compMap) + offset,
          y: deskY(d, compMap) + offset,
          w: deskW(d, compMap),
          h: deskH(d, compMap),
          r: rotationOf(d),
          label: d.label ? `${d.label} (копия)` : undefined,
        }));
        clipboardRef.current = pasted.map((d) => ({ ...d }));
        modifyDesks((prev) => [...prev, ...pasted]);
        sel.selectIds(pasted.map((d) => d.id));
        setSelectedStruct(null);
        onNotice(`Вставлено: ${pasted.length}`);
        return;
      }

      // Duplicate
      if (meta && e.key === 'd' && !inInput && sel.selectedIds.size) {
        e.preventDefault();
        duplicateSelected();
        return;
      }

      if (meta && e.key === 'g' && !e.shiftKey && !inInput) {
        e.preventDefault();
        groupSelected();
        return;
      }
      if (meta && e.key === 'g' && e.shiftKey && !inInput) {
        e.preventDefault();
        ungroupSelected();
        return;
      }

      if (meta && e.key === 'z' && !e.shiftKey && !inInput) {
        e.preventDefault();
        undoRedo.undo(snapshot());
        return;
      }

      if (meta && (e.key === 'y' || (e.key === 'z' && e.shiftKey)) && !inInput) {
        e.preventDefault();
        undoRedo.redo(snapshot());
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
              ? { ...d, x: deskX(d, compMap) + dx, y: deskY(d, compMap) + dy }
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
  }, [sel.selectedIds, desks, zones, drawPoints, measurePoints.length, isDrawMode, tool, selectedStruct, selectedZoneId, structureLocked, compMap]);

  function finishDraw(points = drawPoints) {
    if (points.length < 2) {
      setDrawPoints([]);
      setDrawPreviewPt(null);
      return;
    }
    undoRedo.push(snapshot());
    if (drawStructType === 'zone') {
      if (points.length < 3) {
        setDrawPoints([]);
        setDrawPreviewPt(null);
        return;
      }
      const newZone = {
        id: uid('zone'),
        label: `Зона ${zones.length + 1}`,
        type: 'custom',
        color: zoneDefaultColor('custom'),
        pts: points.map((p) => [p.x, p.y]),
      };
      setZones((prev) => [...prev, newZone]);
      setSelectedZoneId(newZone.id);
      setTool('select');
    } else if (drawStructType === 'infra') {
      finishInfraLine(points);
      setTool('draw_infra');
    } else {
      const newStruct = {
        id: uid(drawStructType),
        pts: points.map((p) => [p.x, p.y]),
        thick: defaultStructThickness(drawStructType),
      };
      if (drawStructType === 'boundary') newStruct.closed = true;
      switch (drawStructType) {
        case 'wall':      setWalls((prev) => [...prev, newStruct]); break;
        case 'boundary':  setBoundaries((prev) => [...prev, newStruct]); break;
        case 'partition': setPartitions((prev) => [...prev, newStruct]); break;
        case 'door':      setDoors((prev) => [...prev, newStruct]); break;
      }
    }
    setDirty(true);
    setDrawPoints([]);
    setDrawPreviewPt(null);
    setDrawSnapPt(null);
    setObjectSnapGuides(null);
  }

  function cancelDraw() {
    setDrawPoints([]);
    setDrawPreviewPt(null);
    setDrawSnapPt(null);
  }

  /* ── data mutations ── */

  function modifyDesks(updater) {
    undoRedo.push(snapshot());
    setDesks(updater);
    setDirty(true);
  }

  function deleteSelected() {
    if (!sel.selectedIds.size) return;
    modifyDesks((prev) => prev.filter((d) => !sel.selectedIds.has(d.id)));
    sel.clearSelection();
  }

  function duplicateSelected() {
    if (!sel.selectedIds.size) return;
    const offset = 20;
    const duped = desks.filter((d) => sel.selectedIds.has(d.id)).map((d) => ({
      ...d,
      id: uid('desk'),
      x: deskX(d, compMap) + offset,
      y: deskY(d, compMap) + offset,
      w: deskW(d, compMap),
      h: deskH(d, compMap),
      r: rotationOf(d),
      workplace_id: d.asset_type === 'workplace' ? uid('wp') : d.workplace_id,
    }));
    modifyDesks((prev) => [...prev, ...duped]);
    sel.selectIds(duped.map((d) => d.id));
    setSelectedStruct(null);
    onNotice(`Дублировано: ${duped.length}`);
  }

  function alignSelected(kind) {
    if (sel.selectedIds.size < 2) return;
    const bbox = boundingBoxOf(desks, sel.selectedIds, compMap);
    if (!bbox) return;
    modifyDesks((prev) => prev.map((desk) => {
      if (!sel.selectedIds.has(desk.id)) return desk;
      const w = deskW(desk, compMap);
      const h = deskH(desk, compMap);
      const patch = {};
      if (kind === 'left') patch.x = bbox.x;
      if (kind === 'hcenter') patch.x = bbox.x + bbox.w / 2 - w / 2;
      if (kind === 'right') patch.x = bbox.x + bbox.w - w;
      if (kind === 'top') patch.y = bbox.y;
      if (kind === 'vcenter') patch.y = bbox.y + bbox.h / 2 - h / 2;
      if (kind === 'bottom') patch.y = bbox.y + bbox.h - h;
      return { ...desk, ...patch };
    }));
  }

  function distributeSelected(axis) {
    if (sel.selectedIds.size < 3) return;
    const selected = desks
      .filter((desk) => sel.selectedIds.has(desk.id))
      .map((desk) => ({
        desk,
        x: deskX(desk, compMap),
        y: deskY(desk, compMap),
        w: deskW(desk, compMap),
        h: deskH(desk, compMap),
      }))
      .sort((a, b) => (
        axis === 'x'
          ? (a.x + a.w / 2) - (b.x + b.w / 2)
          : (a.y + a.h / 2) - (b.y + b.h / 2)
      ));
    const first = selected[0];
    const last = selected[selected.length - 1];
    const start = axis === 'x' ? first.x + first.w / 2 : first.y + first.h / 2;
    const end = axis === 'x' ? last.x + last.w / 2 : last.y + last.h / 2;
    const step = (end - start) / (selected.length - 1);
    const targets = new Map(selected.map((item, index) => {
      const center = start + step * index;
      return [item.desk.id, axis === 'x' ? { x: center - item.w / 2 } : { y: center - item.h / 2 }];
    }));
    modifyDesks((prev) => prev.map((desk) => targets.has(desk.id) ? { ...desk, ...targets.get(desk.id) } : desk));
  }

  function rotateSelectedBy(delta) {
    if (!sel.selectedIds.size) return;
    modifyDesks((prev) => prev.map((desk) => (
      sel.selectedIds.has(desk.id)
        ? { ...desk, r: (rotationOf(desk) + delta) % 360 }
        : desk
    )));
  }

  function deleteSelectedStruct() {
    if (!selectedStruct || structureLocked) return;
    undoRedo.push(snapshot());
    const { type, id } = selectedStruct;
    switch (type) {
      case 'wall':      setWalls((prev) => prev.filter((s) => s.id !== id)); break;
      case 'boundary':  setBoundaries((prev) => prev.filter((s) => s.id !== id)); break;
      case 'partition': setPartitions((prev) => prev.filter((s) => s.id !== id)); break;
      case 'door':      setDoors((prev) => prev.filter((s) => s.id !== id)); break;
    }
    setSelectedStruct(null);
    setDirty(true);
  }

  function updateDesk(id, patch) {
    const geometryPatch = ('w' in patch || 'h' in patch) && !('component_id' in patch) && !('symbol_id' in patch)
      ? { ...patch, size_mode: 'custom' }
      : patch;
    modifyDesks((prev) => prev.map((d) => d.id === id ? { ...d, ...geometryPatch } : d));
  }

  function getStructSetter(type) {
    switch (type) {
      case 'wall': return setWalls;
      case 'boundary': return setBoundaries;
      case 'partition': return setPartitions;
      case 'door': return setDoors;
      default: return null;
    }
  }

  function getStructList(type) {
    switch (type) {
      case 'wall': return walls;
      case 'boundary': return boundaries;
      case 'partition': return partitions;
      case 'door': return doors;
      default: return [];
    }
  }

  function updateStructPoint(type, id, pointIndex, newPt) {
    const setter = getStructSetter(type);
    if (!setter) return;
    setter((prev) => prev.map((s) => {
      if (s.id !== id) return s;
      const pts = [...(s.pts || s.points || [])];
      pts[pointIndex] = [newPt.x, newPt.y];
      return { ...s, pts, points: undefined };
    }));
    setDirty(true);
  }

  function splitStructureSegment(type, id, segIndex) {
    const setter = getStructSetter(type);
    if (!setter) return;
    undoRedo.push(snapshot());
    setter((prev) => prev.map((s) => {
      if (s.id !== id) return s;
      const pts = [...(s.pts || s.points || []).map((p) => Array.isArray(p) ? p : [p.x, p.y])];
      if (segIndex < 0 || segIndex >= pts.length - 1) return s;
      const a = pts[segIndex];
      const b = pts[segIndex + 1];
      const mid = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
      pts.splice(segIndex + 1, 0, mid);
      return { ...s, pts, points: undefined };
    }));
    setDirty(true);
  }

  function toggleStructureLock() {
    const nextLocked = !structureLocked;
    undoRedo.push(snapshot());
    setWalls((prev) => setStructureLockOnItems(prev, nextLocked));
    setBoundaries((prev) => setStructureLockOnItems(prev, nextLocked));
    setPartitions((prev) => setStructureLockOnItems(prev, nextLocked));
    setDoors((prev) => setStructureLockOnItems(prev, nextLocked));
    setStructureLocked(nextLocked);
    if (nextLocked) {
      setSelectedStruct(null);
      if (isDrawMode) {
        setTool('select');
        cancelDraw();
      }
    }
    setDirty(true);
  }

  /* ── infra layer operations ── */

  const INFRA_PRESETS = [
    { name: 'Кабели', color: '#f59e0b' },
    { name: 'Вода', color: '#06b6d4' },
    { name: 'HVAC', color: '#10b981' },
    { name: 'Интернет', color: '#8b5cf6' },
    { name: 'Электрика', color: '#ef4444' },
  ];

  function addInfraLayer(name, color) {
    const id = `il_${Date.now()}`;
    setInfraLayers((prev) => [...prev, { id, name, color, visible: true, items: [] }]);
    setActiveInfraLayerId(id);
    setDirty(true);
  }

  function removeInfraLayer(id) {
    undoRedo.push(snapshot());
    setInfraLayers((prev) => prev.filter((l) => l.id !== id));
    if (activeInfraLayerId === id) setActiveInfraLayerId(null);
    setDirty(true);
  }

  function toggleInfraLayerVisibility(id) {
    setInfraLayers((prev) => prev.map((l) => l.id === id ? { ...l, visible: !l.visible } : l));
  }

  function finishInfraLine(pts, layerId) {
    if (pts.length < 2) return;
    const lid = layerId || activeInfraLayerId;
    if (!lid) return;
    undoRedo.push(snapshot());
    const itemId = `ili_${Date.now()}`;
    setInfraLayers((prev) => prev.map((l) =>
      l.id === lid ? { ...l, items: [...l.items, { id: itemId, pts: pts.map((p) => [p.x, p.y]) }] } : l
    ));
    setDirty(true);
  }

  /* ── PNG export ── */

  function exportPng() {
    const svgEl = viewport.svgRef.current;
    if (!svgEl) return;
    const clone = svgEl.cloneNode(true);
    clone.setAttribute('viewBox', `0 0 ${canvasW} ${canvasH}`);
    clone.setAttribute('width', String(canvasW));
    clone.setAttribute('height', String(canvasH));
    clone.querySelectorAll(
      '.ce-grid,.ce-vertex-handles,.ce-draw-preview,.ce-selection-overlay,.ce-snap-marker,.ce-object-snap-guides'
    ).forEach((el) => el.remove());
    const svgStr = new XMLSerializer().serializeToString(clone);
    const url = URL.createObjectURL(new Blob([svgStr], { type: 'image/svg+xml;charset=utf-8' }));
    const img = new Image();
    img.onload = () => {
      const canvas = document.createElement('canvas');
      canvas.width = canvasW;
      canvas.height = canvasH;
      const ctx = canvas.getContext('2d');
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, canvasW, canvasH);
      ctx.drawImage(img, 0, 0, canvasW, canvasH);
      URL.revokeObjectURL(url);
      const a = document.createElement('a');
      a.download = `floor-${floorId || 'plan'}.png`;
      a.href = canvas.toDataURL('image/png');
      a.click();
    };
    img.onerror = () => URL.revokeObjectURL(url);
    img.src = url;
  }

  /* ── canvas resize ── */

  const CANVAS_PRESETS = [
    { label: 'S  1200×800',  w: 1200, h: 800  },
    { label: 'M  1600×1000', w: 1600, h: 1000 },
    { label: 'L  2000×1400', w: 2000, h: 1400 },
    { label: 'XL 2800×2000', w: 2800, h: 2000 },
  ];

  const canvasResizeParsed = useMemo(() => ({
    w: parseCanvasDim(canvasResizeInput.w),
    h: parseCanvasDim(canvasResizeInput.h),
  }), [canvasResizeInput]);
  const canvasResizeValid = canvasResizeParsed.w !== null && canvasResizeParsed.h !== null;
  const canvasResizeHint = canvasResizeValid
    ? `Будет: ${clampCanvasDim(canvasResizeParsed.w)}×${clampCanvasDim(canvasResizeParsed.h)}`
    : `Введите числа ${CANVAS_MIN_SIZE}-${CANVAS_MAX_SIZE}`;

  function applyCanvasResize(w, h) {
    const parsedW = parseCanvasDim(w);
    const parsedH = parseCanvasDim(h);
    if (parsedW === null || parsedH === null) {
      onError?.('Размер холста должен быть числом');
      return;
    }
    const nw = clampCanvasDim(parsedW);
    const nh = clampCanvasDim(parsedH);
    setCanvasSizeOverride({ w: nw, h: nh });
    setCanvasResizeInput({ w: nw, h: nh });
    setCanvasResizeOpen(false);
    setDirty(true);
  }

  /* ── group operations ── */

  const GROUP_COLORS = ['#2563eb', '#7c3aed', '#059669', '#d97706', '#dc2626', '#0891b2'];

  function groupSelected() {
    if (sel.selectedIds.size < 2) return;
    undoRedo.push(snapshot());
    const deskIds = [...sel.selectedIds];
    const colorIdx = groups.length % GROUP_COLORS.length;
    const newGroup = {
      id: uid('group'),
      label: `Группа ${groups.length + 1}`,
      desk_ids: deskIds,
      locked: false,
      color: GROUP_COLORS[colorIdx],
    };
    setGroups((prev) => [...prev, newGroup]);
    setDirty(true);
  }

  function ungroupSelected() {
    const idsToUngroup = [...sel.selectedIds];
    const matching = groups.filter((g) => g.desk_ids.some((did) => idsToUngroup.includes(did)));
    if (!matching.length) return;
    undoRedo.push(snapshot());
    setGroups((prev) => prev.filter((g) => !matching.includes(g)));
    setDirty(true);
  }

  function updateGroup(groupId, patch) {
    undoRedo.push(snapshot());
    setGroups((prev) => prev.map((g) => g.id === groupId ? { ...g, ...patch } : g));
    setDirty(true);
  }

  function deleteGroup(groupId) {
    undoRedo.push(snapshot());
    setGroups((prev) => prev.filter((g) => g.id !== groupId));
    setDirty(true);
  }

  /* ── zone operations ── */

  function updateZone(zoneId, patch) {
    undoRedo.push(snapshot());
    setZones((prev) => prev.map((z) => z.id === zoneId ? { ...z, ...patch } : z));
    setDirty(true);
  }

  function deleteZone(zoneId) {
    undoRedo.push(snapshot());
    setZones((prev) => prev.filter((z) => z.id !== zoneId));
    setSelectedZoneId(null);
    setDirty(true);
  }

  function selectGroup(groupId) {
    const group = groups.find((g) => g.id === groupId);
    if (group) sel.selectIds(group.desk_ids);
  }

  const selectedInGroup = useMemo(() => {
    if (!sel.selectedIds.size) return null;
    const ids = [...sel.selectedIds];
    return groups.find((g) => ids.some((id) => g.desk_ids.includes(id))) || null;
  }, [groups, sel.selectedIds]);

  const canGroup = sel.selectedIds.size >= 2;
  const canUngroup = !!selectedInGroup;

  function addDeskAt(svgPt) {
    const comp = selectedPlaceComponent || compMap.get('desk-short');
    const componentId = comp?.id || 'desk-short';
    const assetType = comp?.asset_type || 'desk';
    const dw = selectedPlaceSize.w;
    const dh = selectedPlaceSize.h;
    const defaultSize = componentDefaultSize(comp, { w: dw, h: dh });
    const followsComponentSize = placeSizeMode === 'm' && sameNumber(dw, defaultSize.w) && sameNumber(dh, defaultSize.h);
    const rawX = svgPt.x - dw / 2;
    const rawY = svgPt.y - dh / 2;
    const px = grid.snapOn ? Math.round(rawX / grid.gridSize) * grid.gridSize : Math.round(rawX);
    const py = grid.snapOn ? Math.round(rawY / grid.gridSize) * grid.gridSize : Math.round(rawY);
    const usedLabels = new Set(desks.map((d) => d.label));
    const labelPrefix = labelPrefixForComponent(comp);
    let num = desks.length + 1;
    while (usedLabels.has(`${labelPrefix}${num}`)) num++;
    const newDesk = {
      id: uid('desk'),
      label: `${labelPrefix}${num}`,
      x: px, y: py, w: dw, h: dh,
      type: 'flex',
      asset_type: assetType,
      space_type: assetType,
      bookable: assetType === 'workplace',
      component_id: componentId,
      symbol_id: componentId,
      size_mode: followsComponentSize ? 'component' : 'custom',
      component_default_w: defaultSize.w,
      component_default_h: defaultSize.h,
      workplace_id: assetType === 'workplace' ? uid('wp') : undefined,
    };
    modifyDesks((prev) => [...prev, newDesk]);
    sel.selectIds(new Set([newDesk.id]));
    setSelectedStruct(null);
  }

  function resolveObjectSnapDelta(rawDx, rawDy, dragState, event) {
    if (!dragState?.originBBox || event?.altKey) {
      return { dx: rawDx, dy: rawDy, guides: null };
    }
    const tolerance = viewport.worldUnitsForPx(OBJECT_SNAP_PX);
    const { originBBox: bbox, snapAxes } = dragState;
    const xValues = [bbox.x + rawDx, bbox.x + bbox.w / 2 + rawDx, bbox.x + bbox.w + rawDx];
    const yValues = [bbox.y + rawDy, bbox.y + bbox.h / 2 + rawDy, bbox.y + bbox.h + rawDy];
    const xSnap = bestAxisSnap(xValues, snapAxes?.x || [], tolerance);
    const ySnap = bestAxisSnap(yValues, snapAxes?.y || [], tolerance);
    return {
      dx: rawDx + (xSnap?.diff || 0),
      dy: rawDy + (ySnap?.diff || 0),
      guides: xSnap || ySnap ? { x: xSnap?.target, y: ySnap?.target } : null,
    };
  }

  function resizedBackgroundTransform(orig, corner, pt, event) {
    const localPt = inverseRotatePoint(pt, orig);
    let left = orig.x;
    let right = orig.x + orig.w;
    let top = orig.y;
    let bottom = orig.y + orig.h;

    if (corner.includes('w')) left = Math.min(right - MIN_BACKGROUND_SIZE, localPt.x);
    if (corner.includes('e')) right = Math.max(left + MIN_BACKGROUND_SIZE, localPt.x);
    if (corner.includes('n')) top = Math.min(bottom - MIN_BACKGROUND_SIZE, localPt.y);
    if (corner.includes('s')) bottom = Math.max(top + MIN_BACKGROUND_SIZE, localPt.y);

    if (!event.shiftKey) {
      const aspect = Math.max(0.01, orig.w / orig.h);
      const rawW = Math.max(MIN_BACKGROUND_SIZE, right - left);
      const rawH = Math.max(MIN_BACKGROUND_SIZE, bottom - top);
      const scale = Math.max(rawW / orig.w, rawH / orig.h);
      const nextW = Math.max(MIN_BACKGROUND_SIZE, orig.w * scale);
      const nextH = Math.max(MIN_BACKGROUND_SIZE, nextW / aspect);

      if (corner.includes('w')) left = orig.x + orig.w - nextW;
      else right = orig.x + nextW;
      if (corner.includes('n')) top = orig.y + orig.h - nextH;
      else bottom = orig.y + nextH;
    }

    return {
      ...orig,
      x: left,
      y: top,
      w: Math.max(MIN_BACKGROUND_SIZE, right - left),
      h: Math.max(MIN_BACKGROUND_SIZE, bottom - top),
    };
  }

  function rotatedBackgroundTransform(orig, pt, dragState, event) {
    const center = backgroundCenter(orig);
    const angle = Math.atan2(pt.y - center.y, pt.x - center.x) * 180 / Math.PI;
    let rotation = dragState.origRotation + angle - dragState.startAngle;
    if (event.shiftKey) rotation = Math.round(rotation / 15) * 15;
    return { ...orig, rotation };
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

    if (tool === 'measure') {
      e.preventDefault();
      const point = grid.snapPoint(pt, { altSnapOff: e.altKey });
      setMeasurePoints((prev) => (prev.length >= 2 ? [point] : [...prev, point]));
      setMeasurePreviewPt(null);
      sel.clearSelection();
      setSelectedStruct(null);
      setSelectedZoneId(null);
      setSelectedInfraItem(null);
      return;
    }

    if (tool === 'bg_calibrate' && bgImage) {
      e.preventDefault();
      const nextPoints = [...bgCalibrationPoints, pt].slice(-2);
      setBgCalibrationPoints(nextPoints);
      setBgCalibrationInput('');
      return;
    }

    if (tool === 'bg_edit' && bgImage && !bgLocked) {
      const bgActionEl = e.target?.closest?.('[data-bg-action]');
      if (bgActionEl) {
        e.preventDefault();
        const action = bgActionEl.dataset.bgAction;
        const origTransform = normalizeBackgroundTransform(bgTransform, canvasW, canvasH);
        const dragState = {
          action,
          startPt: pt,
          origTransform,
          corner: bgActionEl.dataset.bgCorner,
        };
        if (action === 'rotate') {
          const center = backgroundCenter(origTransform);
          dragState.startAngle = Math.atan2(pt.y - center.y, pt.x - center.x) * 180 / Math.PI;
          dragState.origRotation = origTransform.rotation || 0;
        }
        undoRedo.push(snapshot());
        bgDragRef.current = dragState;
        svgEl.setPointerCapture(e.pointerId);
        return;
      }
    }

    // Place tool — add desk at click
    if (tool === 'place') {
      addDeskAt(pt);
      return;
    }

    // Draw mode — add point to polyline
    if (isDrawMode) {
      if (structureLocked && !isZoneDrawMode) return;
      const { point, snapPoint } = resolveDrawPoint(pt, e);
      setDrawSnapPt(snapPoint);
      const closeTolerance = viewport.worldUnitsForPx(VERTEX_SNAP_PX);
      if ((drawStructType === 'boundary' || drawStructType === 'zone') && drawPoints.length >= 3) {
        const first = drawPoints[0];
        if (Math.hypot(point.x - first.x, point.y - first.y) <= closeTolerance) {
          finishDraw(drawPoints);
          return;
        }
      }
      setDrawPoints((prev) => {
        const last = prev[prev.length - 1];
        if (last && Math.hypot(last.x - point.x, last.y - point.y) < 0.01) return prev;
        return [...prev, point];
      });
      return;
    }

    // Group click — select all desks in the group
    const groupEl = e.target?.closest?.('.ce-group-visual');
    if (groupEl) {
      const groupId = groupEl.dataset.groupId;
      if (groupId) {
        selectGroup(groupId);
        setSelectedStruct(null);
        setSelectedZoneId(null);
        return;
      }
    }

    // Zone click — select zone
    const zoneEl = e.target?.closest?.('.ce-zone-visual');
    if (zoneEl) {
      const zoneId = zoneEl.dataset.zoneId;
      if (zoneId) {
        setSelectedZoneId(zoneId);
        sel.clearSelection();
        setSelectedStruct(null);
        return;
      }
    }

    // Infra item click — select for deletion
    const infraEl = e.target?.closest?.('[data-infra-item]');
    if (infraEl && tool === 'select') {
      const layerId = infraEl.dataset.infraLayer;
      const itemId = infraEl.dataset.infraItem;
      setSelectedInfraItem({ layerId, itemId });
      sel.clearSelection();
      setSelectedStruct(null);
      setSelectedZoneId(null);
      return;
    }

    // Vertex handle drag — start moving a structure point
    const vertexEl = e.target?.closest?.('[data-vertex-idx]');
    if (vertexEl && !structureLocked) {
      const type = vertexEl.dataset.structType;
      const id = vertexEl.dataset.structId;
      const pointIndex = Number(vertexEl.dataset.vertexIdx);
      undoRedo.push(snapshot());
      vertexDragRef.current = { type, id, pointIndex, startPt: pt };
      svgEl.setPointerCapture(e.pointerId);
      return;
    }

    // Segment double-click handled via onSvgDoubleClick (split)

    // Select tool — prefer the actual SVG target for imported structures.
    const structEl = e.target?.closest?.('[data-struct-id]');
    if (structEl && !structureLocked) {
      sel.clearSelection();
      setSelectedStruct({ type: structEl.dataset.structType, id: structEl.dataset.structId });
      return;
    }

    // Select tool — geometry fallback
    const layout = buildLayoutForHitTest();
    const hit = findObjectAtPoint(pt, layout, viewport.worldUnitsForPx(14));

    if (hit?.type === 'desk') {
      setSelectedStruct(null);
      if (e.shiftKey) {
        sel.toggleId(hit.id);
      } else if (!sel.selectedIds.has(hit.id)) {
        sel.selectOne(hit.id);
      }
      if (!desksLocked) {
        const ids = e.shiftKey ? sel.selectedIds : (sel.selectedIds.has(hit.id) ? sel.selectedIds : new Set([hit.id]));
        const origins = new Map();
        for (const id of ids) {
          const d = desks.find((dd) => dd.id === id);
          if (d) origins.set(id, { x: deskX(d, compMap), y: deskY(d, compMap) });
        }
        dragRef.current = {
          startSvgPt: pt,
          origins,
          moved: false,
          snapshot: snapshot(),
          originBBox: boundingBoxOf(desks, ids, compMap),
          snapAxes: collectDeskSnapAxes(desks, ids, compMap, structureSnapPoints),
        };
        svgEl.setPointerCapture(e.pointerId);
      }
      return;
    }

    // Structure click — select it
    if (hit && hit.type !== 'desk' && !structureLocked) {
      sel.clearSelection();
      setSelectedStruct(hit);
      return;
    }

    // Click on empty space → start marquee
    if (!e.shiftKey) sel.clearSelection();
    setSelectedStruct(null);
    setSelectedZoneId(null);
    setSelectedInfraItem(null);
    sel.startMarquee(pt, { append: e.shiftKey });
    svgEl.setPointerCapture(e.pointerId);
  }, [
    tool,
    viewport,
    sel,
    desks,
    groups,
    walls,
    boundaries,
    partitions,
    doors,
    zones,
    isDrawMode,
    isZoneDrawMode,
    grid,
    structureLocked,
    compMap,
    selectedPlaceComponent,
    selectedPlaceSize,
    resolveDrawPoint,
    structureSnapPoints,
    drawPoints,
    drawStructType,
    layerVis,
    desksLocked,
    bgImage,
    bgLocked,
    bgTransform,
    bgCalibrationPoints,
    canvasW,
    canvasH,
  ]);

  const onSvgPointerMove = useCallback((e) => {
    const pt = viewport.screenToSvg(e);
    setCursorSvgPt(pt);

    // Draw preview
    if (isDrawMode && drawPoints.length > 0) {
      const { point, snapPoint } = resolveDrawPoint(pt, e);
      setDrawPreviewPt(point);
      setDrawSnapPt(snapPoint);
    } else if (isDrawMode) {
      const { snapPoint } = resolveDrawPoint(pt, e);
      setDrawSnapPt(snapPoint);
    }

    if (tool === 'measure' && measurePoints.length === 1) {
      setMeasurePreviewPt(grid.snapPoint(pt, { altSnapOff: e.altKey }));
    }

    // Pan
    if (isPanningRef.current) {
      viewport.updatePan(e);
      return;
    }

    // Vertex drag
    if (vertexDragRef.current) {
      const { type, id, pointIndex } = vertexDragRef.current;
      const snapped = { x: grid.snap(pt.x, { altSnapOff: e.altKey }), y: grid.snap(pt.y, { altSnapOff: e.altKey }) };
      updateStructPoint(type, id, pointIndex, snapped);
      return;
    }

    // Background image drag
    if (bgDragRef.current) {
      const { action, startPt, origTransform, corner } = bgDragRef.current;
      if (action === 'move') {
        const dx = pt.x - startPt.x;
        const dy = pt.y - startPt.y;
        setBgTransform({ ...origTransform, x: origTransform.x + dx, y: origTransform.y + dy });
      } else if (action === 'resize') {
        setBgTransform(resizedBackgroundTransform(origTransform, corner || 'se', pt, e));
      } else if (action === 'rotate') {
        setBgTransform(rotatedBackgroundTransform(origTransform, pt, bgDragRef.current, e));
      }
      setDirty(true);
      return;
    }

    // Rotate drag
    if (rotateRef.current) {
      const { deskId, center, startAngle, origR } = rotateRef.current;
      const angle = Math.atan2(pt.y - center.y, pt.x - center.x) * 180 / Math.PI;
      let nextR = origR + angle - startAngle;
      if (e.shiftKey) nextR = Math.round(nextR / 15) * 15;
      setDesks((prev) => prev.map((d) => d.id === deskId ? { ...d, r: nextR } : d));
      setDirty(true);
      return;
    }

    // Resize drag
    if (resizeRef.current) {
      const { deskId, corner, startPt, origX, origY, origW, origH } = resizeRef.current;
      const dx = pt.x - startPt.x;
      const dy = pt.y - startPt.y;
      let nx = origX, ny = origY, nw = origW, nh = origH;
      // corner: 0=TL, 1=TR, 2=BL, 3=BR
      if (corner === 0) { nx = origX + dx; ny = origY + dy; nw = origW - dx; nh = origH - dy; }
      if (corner === 1) { ny = origY + dy; nw = origW + dx; nh = origH - dy; }
      if (corner === 2) { nx = origX + dx; nw = origW - dx; nh = origH + dy; }
      if (corner === 3) { nw = origW + dx; nh = origH + dy; }
      if (nw < 20) { nw = 20; if (corner === 0 || corner === 2) nx = origX + origW - 20; }
      if (nh < 20) { nh = 20; if (corner === 0 || corner === 1) ny = origY + origH - 20; }
      nx = grid.snap(nx); ny = grid.snap(ny);
      nw = grid.snap(nw); nh = grid.snap(nh);
      setDesks((prev) => prev.map((d) => d.id === deskId ? { ...d, x: nx, y: ny, w: nw, h: nh, size_mode: 'custom' } : d));
      setDirty(true);
      return;
    }

    // Desk drag
    if (dragRef.current) {
      const { startSvgPt, origins } = dragRef.current;
      const dx = pt.x - startSvgPt.x;
      const dy = pt.y - startSvgPt.y;

      if (!dragRef.current.moved && Math.hypot(dx, dy) < DRAG_MIN) return;
      dragRef.current.moved = true;
      const snapped = resolveObjectSnapDelta(dx, dy, dragRef.current, e);
      setObjectSnapGuides(snapped.guides);

      setDesks((prev) =>
        prev.map((d) => {
          const orig = origins.get(d.id);
          if (!orig) return d;
          return {
            ...d,
            x: grid.snap(orig.x + snapped.dx, { altSnapOff: e.altKey }),
            y: grid.snap(orig.y + snapped.dy, { altSnapOff: e.altKey }),
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
  }, [viewport, sel, grid, isDrawMode, tool, drawPoints, measurePoints.length, compMap, resolveDrawPoint]);

  const onSvgDoubleClick = useCallback((e) => {
    const minPts = isZoneDrawMode ? 3 : 2;
    if (isDrawMode && drawPoints.length >= minPts) {
      e.preventDefault();
      finishDraw();
      return;
    }
    // Double-click on structure segment → split (add midpoint)
    const segEl = e.target?.closest?.('[data-seg-idx]');
    if (segEl && !structureLocked) {
      const type = segEl.dataset.structType;
      const id = segEl.dataset.structId;
      const segIdx = Number(segEl.dataset.segIdx);
      splitStructureSegment(type, id, segIdx);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isDrawMode, isZoneDrawMode, drawPoints, drawStructType, structureLocked]);

  const onSvgPointerUp = useCallback((e) => {
    const svgEl = viewport.svgRef.current;

    // Pan end
    if (isPanningRef.current) {
      isPanningRef.current = false;
      viewport.endPan();
      try { svgEl?.releasePointerCapture(e.pointerId); } catch {}
      return;
    }

    // Vertex drag end
    if (vertexDragRef.current) {
      vertexDragRef.current = null;
      try { svgEl?.releasePointerCapture(e.pointerId); } catch {}
      return;
    }

    // Background drag end
    if (bgDragRef.current) {
      bgDragRef.current = null;
      try { svgEl?.releasePointerCapture(e.pointerId); } catch {}
      return;
    }

    // Resize end
    if (resizeRef.current) {
      resizeRef.current = null;
      try { svgEl?.releasePointerCapture(e.pointerId); } catch {}
      return;
    }

    // Rotate end
    if (rotateRef.current) {
      rotateRef.current = null;
      try { svgEl?.releasePointerCapture(e.pointerId); } catch {}
      return;
    }

    // Desk drag end
    if (dragRef.current) {
      if (dragRef.current.moved) {
        undoRedo.push(dragRef.current.snapshot);
      }
      dragRef.current = null;
      setObjectSnapGuides(null);
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
    return {
      desks: desks.map((d) => ({
        ...d,
        x: deskX(d, compMap),
        y: deskY(d, compMap),
        w: deskW(d, compMap),
        h: deskH(d, compMap),
      })),
      walls: structureLocked || !layerVis.walls ? [] : walls,
      boundaries: structureLocked || !layerVis.boundaries ? [] : boundaries,
      partitions: structureLocked || !layerVis.partitions ? [] : partitions,
      doors: structureLocked || !layerVis.doors ? [] : doors,
    };
  }

  /* ── zoom to fit selection or all ── */
  function handleZoomToFit() {
    const bb = sel.selectedIds.size
      ? boundingBoxOf(desks, sel.selectedIds, compMap)
      : boundingBoxOf(desks, null, compMap) || { x: 0, y: 0, w: canvasW, h: canvasH };
    if (bb) viewport.zoomToFit(bb, 60);
  }

  const currentLayoutDoc = useCallback(() => {
    const usedComponentIds = new Set(desks.map((d) => d.component_id || d.symbol_id).filter(Boolean));
    const customComponents = componentCatalog
      .filter((c) => !c.is_system && usedComponentIds.has(c.id))
      .map(({ is_system, palette_group, ...component }) => component);
    return {
      ...(layout?.layout || {}),
      vb: [0, 0, canvasW, canvasH],
      pixels_per_meter: pixelsPerMeter || undefined,
      components: customComponents,
      desks,
      walls: setStructureLockOnItems(walls, structureLocked),
      boundaries: setStructureLockOnItems(boundaries, structureLocked),
      partitions: setStructureLockOnItems(partitions, structureLocked),
      doors: setStructureLockOnItems(doors, structureLocked),
      groups,
      zones,
      infra_layers: infraLayers,
      background: bgImage
        ? {
            image: bgImage,
            opacity: bgOpacity,
            visible: bgVisible,
            locked: bgLocked,
            transform: normalizeBackgroundTransform(bgTransform, canvasW, canvasH),
            calibration: bgCalibration || undefined,
          }
        : undefined,
    };
  }, [componentCatalog, layout, desks, walls, boundaries, partitions, doors, groups, zones, infraLayers, structureLocked, bgImage, bgOpacity, bgVisible, bgLocked, bgTransform, bgCalibration, canvasW, canvasH]);

  /* ── save ── */
  const saveDraft = useCallback(async ({ silent = false } = {}) => {
    if (!floorId) return null;
    if (!dirty) return { saved: false, layout: currentLayoutDoc() };
    if (savingRef.current) return null;
    savingRef.current = true;
    setSaving(true);
    onError('');
    try {
      const doc = currentLayoutDoc();
      const response = await apiFetch(`/floors/${floorId}/layout/draft`, {
        method: 'PUT',
        body: JSON.stringify({ version: layout?.version || 0, layout: doc }),
      });
      setDirty(false);
      if (!silent) onNotice('Черновик сохранён');
      await onLayoutChange?.();
      return response;
    } catch (err) {
      onError(err.message);
      throw err;
    } finally {
      savingRef.current = false;
      setSaving(false);
    }
  }, [currentLayoutDoc, dirty, floorId, layout?.version, onError, onLayoutChange, onNotice]);

  useEffect(() => {
    if (!dirty || !floorId) return undefined;
    autoSaveRef.current = setTimeout(() => {
      saveDraft({ silent: true }).catch(() => {});
    }, 30000);
    return () => clearTimeout(autoSaveRef.current);
  }, [dirty, floorId, saveDraft]);

  /* ── insert objects from block ── */
  function insertObjects(rawDesks) {
    if (!rawDesks?.length) return;
    // find canvas center in SVG coords
    const vb = viewport.viewBoxAttr ? viewport.viewBoxAttr.split(' ').map(Number) : [0, 0, canvasW, canvasH];
    const cx = vb[0] + vb[2] / 2;
    const cy = vb[1] + vb[3] / 2;
    // compute block bounding box origin
    let minX = Infinity, minY = Infinity;
    for (const d of rawDesks) {
      const x = Number(d.x ?? d.position?.x ?? 0);
      const y = Number(d.y ?? d.position?.y ?? 0);
      if (x < minX) minX = x;
      if (y < minY) minY = y;
    }
    if (!Number.isFinite(minX)) { minX = 0; minY = 0; }
    const inserted = rawDesks.map((d) => ({
      ...d,
      id: uid('desk'),
      x: (cx - minX) + Number(d.x ?? d.position?.x ?? 0),
      y: (cy - minY) + Number(d.y ?? d.position?.y ?? 0),
    }));
    modifyDesks((prev) => [...prev, ...inserted]);
    sel.selectIds(inserted.map((d) => d.id));
    onNotice(`Вставлено из блока: ${inserted.length} объектов`);
  }

  /* ── save selected desks as block ── */
  async function saveSelectedAsBlock() {
    if (!sel.selectedIds.size) return;
    const selected = desks.filter((d) => sel.selectedIds.has(d.id));
    if (selected.length < 1) return;
    const name = prompt('Название блока:');
    if (!name) return;
    try {
      await apiFetch('/blocks', {
        method: 'POST',
        body: JSON.stringify({
          name,
          category: 'custom',
          objects: selected.map((d) => ({
            id: d.id,
            label: d.label,
            component_id: d.component_id || d.symbol_id,
            asset_type: d.asset_type,
            x: deskX(d, compMap),
            y: deskY(d, compMap),
            w: deskW(d, compMap),
            h: deskH(d, compMap),
            r: rotationOf(d),
            bookable: d.bookable,
          })),
        }),
      });
      onNotice(`Блок «${name}» сохранён (${selected.length} объектов)`);
    } catch (err) {
      onError(err.message);
    }
  }

  useImperativeHandle(ref, () => ({
    hasDirty: () => dirty,
    getCurrentLayout: currentLayoutDoc,
    saveIfDirty: () => saveDraft({ silent: true }),
    insertObjects,
    getSelectedDesks: () => desks.filter((d) => sel.selectedIds.has(d.id)),
    hasSelection: () => sel.selectedIds.size > 0,
    triggerBgUpload: () => bgFileRef.current?.click(),
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }), [currentLayoutDoc, dirty, saveDraft, desks, sel.selectedIds]);

  function resetChanges() {
    const nextDesks = (layout?.layout?.desks || []).map((desk, index) => normalizeDesk(desk, index, compMap));
    const nextWalls = layout?.layout?.walls || [];
    const nextBoundaries = layout?.layout?.boundaries || [];
    const nextPartitions = layout?.layout?.partitions || [];
    const nextDoors = layout?.layout?.doors || [];
    setDesks(nextDesks);
    setWalls(nextWalls);
    setBoundaries(nextBoundaries);
    setPartitions(nextPartitions);
    setDoors(nextDoors);
    setGroups(layout?.layout?.groups || []);
    setZones(layout?.layout?.zones || []);
    const nextBackground = backgroundFromLayout(layout?.layout);
    setBgImage(nextBackground.image);
    setBgOpacity(nextBackground.opacity);
    setBgVisible(nextBackground.visible);
    setBgLocked(nextBackground.locked);
    setBgTransform(normalizeBackgroundTransform(nextBackground.transform, canvasW, canvasH));
    setBgCalibration(nextBackground.calibration);
    setBgCalibrationPoints([]);
    setBgCalibrationInput('');
    setStructureLocked(structuresLocked(nextWalls, nextBoundaries, nextPartitions, nextDoors));
    sel.clearSelection();
    setDrawPoints([]);
    setDrawPreviewPt(null);
    setDrawSnapPt(null);
    setObjectSnapGuides(null);
    setDirty(false);
    undoRedo.clear();
  }

  /* ── derived ── */
  const selectedDesk = sel.selectedIds.size === 1
    ? desks.find((d) => d.id === [...sel.selectedIds][0])
    : null;

  const selBBox = useMemo(() => {
    if (!sel.selectedIds.size) return null;
    return boundingBoxOf(desks, sel.selectedIds, compMap);
  }, [desks, sel.selectedIds, compMap]);
  const selectedObjectSize = useMemo(() => {
    if (selectedDesk) {
      return {
        w: deskW(selectedDesk, compMap),
        h: deskH(selectedDesk, compMap),
      };
    }
    if (selBBox) return { w: selBBox.w, h: selBBox.h };
    return null;
  }, [selectedDesk, selBBox, compMap]);
  const selectedObjectSizeText = selectedObjectSize
    ? `${formatUnits(selectedObjectSize.w)}×${formatUnits(selectedObjectSize.h)} ед. · ${formatMeters(selectedObjectSize.w, pixelsPerMeter)}×${formatMeters(selectedObjectSize.h, pixelsPerMeter)} м`
    : null;
  const selectedStructLengthText = useMemo(() => {
    if (!selectedStruct) return null;
    const item = getStructList(selectedStruct.type).find((s) => s.id === selectedStruct.id);
    if (!item) return null;
    const length = lengthOfSegments(segmentsFromStructure(item, selectedStruct.type === 'boundary'));
    if (length <= 0) return null;
    return `${formatUnits(length)} ед. · ${formatMeters(length, pixelsPerMeter)} м`;
  }, [selectedStruct, walls, boundaries, partitions, doors, pixelsPerMeter]);
  const structureCount = walls.length + boundaries.length + partitions.length + doors.length;
  const measureEndPoint = measurePoints[1] || (tool === 'measure' ? measurePreviewPt : null);
  const measureDistance = measurePoints[0] && measureEndPoint
    ? distanceBetween(measurePoints[0], measureEndPoint)
    : 0;
  const measureText = measureDistance > 0
    ? `${formatUnits(measureDistance)} ед. · ${formatMeters(measureDistance, pixelsPerMeter)} м`
    : null;
  const measureMidPoint = measurePoints[0] && measureEndPoint
    ? {
        x: (measurePoints[0].x + measureEndPoint.x) / 2,
        y: (measurePoints[0].y + measureEndPoint.y) / 2,
      }
    : null;
  const bgFrame = useMemo(
    () => normalizeBackgroundTransform(bgTransform, canvasW, canvasH),
    [bgTransform, canvasW, canvasH],
  );
  const bgHandles = useMemo(() => backgroundHandlePoints(bgFrame), [bgFrame]);
  const bgCenter = backgroundCenter(bgFrame);
  const bgScalePercent = useMemo(() => {
    const percent = backgroundScalePercent(bgFrame, bgNaturalSize);
    return percent === null ? null : Math.round(percent);
  }, [bgFrame, bgNaturalSize]);
  const bgRotationDegrees = Math.round(normalizeRotationDegrees(bgFrame.rotation || 0));
  const bgFramePoints = [bgHandles.nw, bgHandles.ne, bgHandles.se, bgHandles.sw]
    .map((p) => `${p.x},${p.y}`)
    .join(' ');

  /* ── cursor class ── */
  const cursorClass = isPanningRef.current
    ? 'cursor-panning'
    : (tool === 'pan' || spaceRef.current)
      ? 'cursor-pan'
      : (isDrawMode || tool === 'bg_calibrate' || tool === 'measure')
        ? 'cursor-crosshair'
        : 'cursor-default';

  /* ── grid lines ── */
  const gridLines = useMemo(() => {
    const step = Math.max(1, metricGridStep);
    if (!grid.gridVisible) return null;
    const cols = Math.ceil(canvasW / step) + 1;
    const rows = Math.ceil(canvasH / step) + 1;
    return { cols, rows, step, majorEvery: METRIC_GRID_DIVISIONS };
  }, [grid.gridVisible, metricGridStep, canvasW, canvasH]);

  const drawIssue = useMemo(
    () => drawValidationIssue(drawStructType, drawPoints, drawPreviewPt),
    [drawStructType, drawPoints, drawPreviewPt],
  );

  /* ── render ── */
  return (
    <div className={`floor-canvas-editor ${propertiesCollapsed ? 'props-collapsed' : 'props-open'}`} tabIndex={0}>

      {/* ── Toolbar ── */}
      <div
        className="ce-toolbar"
        onPointerOver={showToolbarTip}
        onPointerOut={onToolbarPointerOut}
        onFocus={showToolbarTip}
        onBlur={hideToolbarTip}
      >
        <button
          className={`ce-tool-btn ${tool === 'select' ? 'active' : ''}`}
          title="Выбор (V)"
          onClick={() => setTool('select')}
        >
          <MousePointer size={14} /><KBD>V</KBD>
        </button>
        <button
          className={`ce-tool-btn ${tool === 'pan' ? 'active' : ''}`}
          title="Двигать холст (Space+drag)"
          onClick={() => setTool('pan')}
        >
          <Move size={14} /><KBD>Space</KBD>
        </button>
        <button
          className={`ce-tool-btn ${tool === 'place' ? 'active' : ''}`}
          title="Добавить объект (P)"
          onClick={() => setTool(tool === 'place' ? 'select' : 'place')}
        >
          <Plus size={14} /><KBD>P</KBD>
        </button>
        <button
          className={`ce-tool-btn ${tool === 'measure' ? 'active' : ''}`}
          title="Линейка: измерить расстояние (M)"
          onClick={() => { cancelDraw(); setTool(tool === 'measure' ? 'select' : 'measure'); }}
        >
          <Ruler size={14} /><KBD>M</KBD>
        </button>

        <div className="ce-toolbar-sep" />

        <button
          className={`ce-tool-btn ${tool === 'draw_wall' ? 'active' : ''}`}
          title={structureLocked ? 'Слой конструкций заблокирован' : 'Стена (W)'}
          disabled={structureLocked}
          onClick={() => { cancelDraw(); setTool(tool === 'draw_wall' ? 'select' : 'draw_wall'); }}
        >
          <Minus size={14} /><KBD>W</KBD>
        </button>
        <button
          className={`ce-tool-btn ${tool === 'draw_zone' ? 'active' : ''}`}
          title="Зона (Z)"
          onClick={() => { cancelDraw(); setTool(tool === 'draw_zone' ? 'select' : 'draw_zone'); }}
        >
          <MapIcon size={14} /><KBD>Z</KBD>
        </button>
        <button
          className={`ce-tool-btn ${isInfraDrawMode ? 'active' : ''}`}
          title={activeInfraLayerId ? 'Коммуникации (I) — рисовать линию слоя' : 'Выберите слой коммуникаций'}
          disabled={!activeInfraLayerId}
          onClick={() => { cancelDraw(); setTool(isInfraDrawMode ? 'select' : 'draw_infra'); }}
        >
          <Activity size={14} /><KBD>I</KBD>
        </button>
        <button
          className={`ce-tool-btn ${tool === 'draw_partition' ? 'active' : ''}`}
          title={structureLocked ? 'Слой конструкций заблокирован' : 'Перегородка'}
          disabled={structureLocked}
          onClick={() => { cancelDraw(); setTool(tool === 'draw_partition' ? 'select' : 'draw_partition'); }}
        >
          <Pencil size={14} />
        </button>
        <button
          className={`ce-tool-btn ${tool === 'draw_door' ? 'active' : ''}`}
          title={structureLocked ? 'Слой конструкций заблокирован' : 'Дверь'}
          disabled={structureLocked}
          onClick={() => { cancelDraw(); setTool(tool === 'draw_door' ? 'select' : 'draw_door'); }}
        >
          <DoorOpen size={14} />
        </button>

        <div className="ce-toolbar-sep" />

        <button className="ce-tool-btn" title="Приблизить (+)" onClick={() => viewport.zoomBy(1 / 1.25)}>
          <ZoomIn size={14} />
        </button>
        <button className="ce-tool-btn" title="Отдалить (−)" onClick={() => viewport.zoomBy(1.25)}>
          <ZoomOut size={14} />
        </button>
        <span className="ce-zoom-label">{Math.round(viewport.zoom * 100)}%</span>
        <button className="ce-tool-btn" title="Показать всё (F)" onClick={handleZoomToFit}>
          <Maximize size={14} /><KBD>F</KBD>
        </button>

        <div className="ce-toolbar-sep" />

        <button
          className={`ce-tool-btn ${grid.gridVisible ? 'active' : ''}`}
          title={`Сетка: малая 0.25 м (${formatUnits(metricGridStep)} ед.), крупная 1 м`}
          onClick={grid.toggleVisible}
        >
          <Grid3X3 size={14} />
        </button>
        <button
          className={`ce-tool-btn ${grid.snapOn ? 'active' : ''}`}
          title={grid.snapOn ? 'Привязка к сетке 0.25 м вкл' : 'Привязка к сетке 0.25 м выкл'}
          onClick={grid.toggleSnap}
        >
          <Magnet size={14} />
        </button>
        <button
          className={`ce-tool-btn ${desksLocked ? 'active' : ''}`}
          title={desksLocked ? 'Объекты зафиксированы — нажми чтобы разблокировать (L)' : 'Зафиксировать объекты (L)'}
          onClick={() => setDesksLocked((prev) => !prev)}
        >
          {desksLocked ? <Lock size={14} /> : <Unlock size={14} />}<KBD>L</KBD>
        </button>

        <div className="ce-toolbar-sep" />

        <button
          className={`ce-tool-btn ${layerPanelOpen ? 'active' : ''}`}
          title="Слои"
          onClick={() => setLayerPanelOpen(!layerPanelOpen)}
        >
          <Layers size={14} />
        </button>
        <button
          className={`ce-tool-btn ${searchOpen ? 'active' : ''}`}
          title="Поиск (Ctrl+F)"
          onClick={() => { setSearchOpen(!searchOpen); setSearchQuery(''); }}
        >
          <Search size={14} />
        </button>
        <button
          className={`ce-tool-btn ${kbdPanelOpen ? 'active' : ''}`}
          title="Горячие клавиши (?)"
          onClick={() => setKbdPanelOpen((prev) => !prev)}
        >
          <Keyboard size={14} />
        </button>
        <button
          className="ce-tool-btn"
          title="Экспортировать PNG"
          onClick={exportPng}
        >
          <Download size={14} />
        </button>
        <button
          className={`ce-tool-btn ${canvasResizeOpen ? 'active' : ''}`}
          title="Размер холста"
          onClick={() => {
            setCanvasResizeInput({ w: canvasW, h: canvasH });
            setCanvasResizeOpen((prev) => !prev);
          }}
        >
          <Maximize2 size={14} />
        </button>

        {(sel.selectedIds.size > 0 || selectedStruct) && (
          <>
            <div className="ce-toolbar-sep" />
            {sel.selectedIds.size > 0 && (
              <button
                className="ce-tool-btn"
                title="Копировать (Ctrl+C)"
                onClick={() => {
                  clipboardRef.current = desks.filter((d) => sel.selectedIds.has(d.id)).map((d) => ({ ...d }));
                  onNotice(`Скопировано: ${clipboardRef.current.length}`);
                }}
              >
                <Copy size={14} />
              </button>
            )}
            {sel.selectedIds.size > 0 && (
              <button
                className="ce-tool-btn"
                title="Дублировать (Ctrl+D)"
                onClick={duplicateSelected}
              >
                <Copy size={14} />
                <Plus size={10} />
              </button>
            )}
            {sel.selectedIds.size > 0 && (
              <button
                className="ce-tool-btn"
                title="Повернуть выбранное на 90°"
                onClick={() => rotateSelectedBy(90)}
              >
                <RotateCw size={14} />
              </button>
            )}
            {sel.selectedIds.size > 1 && (
              <>
                <button className="ce-tool-btn" title="Выровнять слева" onClick={() => alignSelected('left')}>
                  <AlignHorizontalJustifyStart size={14} />
                </button>
                <button className="ce-tool-btn" title="Выровнять по центру X" onClick={() => alignSelected('hcenter')}>
                  <AlignHorizontalJustifyCenter size={14} />
                </button>
                <button className="ce-tool-btn" title="Выровнять справа" onClick={() => alignSelected('right')}>
                  <AlignHorizontalJustifyEnd size={14} />
                </button>
                <button className="ce-tool-btn" title="Выровнять сверху" onClick={() => alignSelected('top')}>
                  <AlignVerticalJustifyStart size={14} />
                </button>
                <button className="ce-tool-btn" title="Выровнять по центру Y" onClick={() => alignSelected('vcenter')}>
                  <AlignVerticalJustifyCenter size={14} />
                </button>
                <button className="ce-tool-btn" title="Выровнять снизу" onClick={() => alignSelected('bottom')}>
                  <AlignVerticalJustifyEnd size={14} />
                </button>
              </>
            )}
            {sel.selectedIds.size > 2 && (
              <>
                <button className="ce-tool-btn" title="Распределить по горизонтали" onClick={() => distributeSelected('x')}>
                  <AlignHorizontalSpaceBetween size={14} />
                </button>
                <button className="ce-tool-btn" title="Распределить по вертикали" onClick={() => distributeSelected('y')}>
                  <AlignVerticalSpaceBetween size={14} />
                </button>
              </>
            )}
            {canGroup && (
              <button
                className="ce-tool-btn"
                title="Объединить в группу (Ctrl+G)"
                onClick={groupSelected}
              >
                <Group size={14} />
              </button>
            )}
            {canUngroup && (
              <button
                className="ce-tool-btn"
                title="Разгруппировать (Ctrl+Shift+G)"
                onClick={ungroupSelected}
              >
                <Ungroup size={14} />
              </button>
            )}
            {sel.selectedIds.size >= 1 && (
              <button
                className="ce-tool-btn"
                title="Сохранить выбранное как блок"
                onClick={saveSelectedAsBlock}
              >
                <Package size={14} />
              </button>
            )}
            <button
              className="ce-tool-btn danger"
              title="Удалить выбранное (Del)"
              onClick={selectedStruct ? deleteSelectedStruct : deleteSelected}
            >
              <Trash2 size={14} />
            </button>
          </>
        )}

        <div className="ce-toolbar-sep" />

        {/* Background tracing image controls */}
        <input
          ref={bgFileRef}
          type="file"
          accept="image/png,image/jpeg,image/webp,image/svg+xml,application/pdf"
          style={{ display: 'none' }}
          onChange={onBgFileChange}
        />
        <button
          className={`ce-tool-btn icon-text ${bgImage ? 'active' : ''}`}
          title="Загрузить фоновое изображение для обводки стен"
          onClick={() => bgFileRef.current?.click()}
        >
          <ImageIcon size={14} />
          <span>Фон</span>
        </button>
        {bgImage && (
          <>
            <button
              className={`ce-tool-btn mini ${bgVisible ? 'active' : ''}`}
              title={bgVisible ? 'Скрыть фон' : 'Показать фон'}
              onClick={() => {
                undoRedo.push(snapshot());
                setBgVisible((v) => !v);
                setDirty(true);
              }}
            >
              {bgVisible ? <Eye size={12} /> : <EyeOff size={12} />}
            </button>
            <input
              type="range"
              min={0.05} max={1} step={0.05}
              value={bgOpacity}
              onChange={(e) => {
                setBgOpacity(Number(e.target.value));
                setDirty(true);
              }}
              title={`Прозрачность фона: ${Math.round(bgOpacity * 100)}%`}
              className="ce-bg-opacity-slider"
            />
            <button
              className={`ce-tool-btn mini ${tool === 'bg_edit' ? 'active' : ''}`}
              title={bgLocked ? 'Фон зафиксирован' : 'Подогнать фон: двигать, менять размер, вращать'}
              disabled={bgLocked}
              onClick={() => {
                cancelDraw();
                setTool(tool === 'bg_edit' ? 'select' : 'bg_edit');
              }}
            >
              <Move size={12} />
            </button>
            <span className="ce-bg-transform-controls" aria-label="Трансформация подложки">
              <button
                className="ce-tool-btn mini"
                title="Уменьшить подложку на 10%"
                disabled={bgLocked}
                onClick={() => zoomBackgroundBy(0.9)}
              >
                <ZoomOut size={12} />
              </button>
              <span className="ce-bg-transform-readout" title="Масштаб подложки">
                {bgScalePercent === null ? '—' : `${bgScalePercent}%`}
              </span>
              <button
                className="ce-tool-btn mini"
                title="Увеличить подложку на 10%"
                disabled={bgLocked}
                onClick={() => zoomBackgroundBy(1.1)}
              >
                <ZoomIn size={12} />
              </button>
              <button
                className="ce-tool-btn mini"
                title="Повернуть подложку влево на 15°"
                disabled={bgLocked}
                onClick={() => rotateBackgroundBy(-15)}
              >
                <RotateCcw size={12} />
              </button>
              <span className="ce-bg-transform-readout" title="Поворот подложки">
                {bgRotationDegrees}°
              </span>
              <button
                className="ce-tool-btn mini"
                title="Повернуть подложку вправо на 15°"
                disabled={bgLocked}
                onClick={() => rotateBackgroundBy(15)}
              >
                <RotateCw size={12} />
              </button>
            </span>
            <button
              className="ce-tool-btn mini"
              title="Вписать фон в холст"
              onClick={fitBackgroundToCanvas}
            >
              <Maximize2 size={12} />
            </button>
            <button
              className={`ce-tool-btn mini ${tool === 'bg_calibrate' ? 'active' : ''}`}
              title="Калибровать масштаб по двум точкам"
              onClick={startBackgroundCalibration}
            >
              <Target size={12} />
            </button>
            <button
              className={`ce-tool-btn mini ${bgLocked ? 'active' : ''}`}
              title={bgLocked ? 'Разблокировать фон' : 'Зафиксировать фон'}
              onClick={toggleBackgroundLock}
            >
              {bgLocked ? <Lock size={12} /> : <Unlock size={12} />}
            </button>
            {/* PDF page navigation */}
            {bgPdfPages > 1 && (
              <span className="ce-pdf-nav">
                <button
                  className="ce-tool-btn mini"
                  title="Предыдущая страница PDF"
                  disabled={bgPdfPage <= 1 || bgPdfLoading}
                  onClick={() => navigatePdfPage(-1)}
                >
                  ‹
                </button>
                <span className="ce-pdf-page-label">
                  {bgPdfLoading ? '…' : `${bgPdfPage}/${bgPdfPages}`}
                </span>
                <button
                  className="ce-tool-btn mini"
                  title="Следующая страница PDF"
                  disabled={bgPdfPage >= bgPdfPages || bgPdfLoading}
                  onClick={() => navigatePdfPage(1)}
                >
                  ›
                </button>
              </span>
            )}
            {bgPdfLoading && bgPdfPages === 0 && (
              <span className="ce-pdf-loading">PDF…</span>
            )}
            <button
              className="ce-tool-btn mini danger"
              title="Удалить фоновое изображение"
              onClick={() => {
                undoRedo.push(snapshot());
                setBgImage(null);
                setBgLocked(false);
                setBgTransform(defaultBackgroundTransform(canvasW, canvasH));
                setBgCalibration(null);
                setBgCalibrationPoints([]);
                setBgCalibrationInput('');
                setBgNaturalSize(null);
                setBgPdfData(null);
                setBgPdfPages(0);
                setBgPdfPage(1);
                setDirty(true);
              }}
            >
              <Trash2 size={12} />
            </button>
          </>
        )}

        <div className="ce-toolbar-spacer" />

        <button
          className="ce-tool-btn"
          title="Отменить (Ctrl+Z)"
          disabled={!undoRedo.canUndo}
          onClick={() => undoRedo.undo(snapshot())}
        >
          <Undo2 size={14} />
        </button>
        <button
          className="ce-tool-btn"
          title="Повторить (Ctrl+Shift+Z)"
          disabled={!undoRedo.canRedo}
          onClick={() => undoRedo.redo(snapshot())}
        >
          <Redo2 size={14} />
        </button>

        {dirty && (
          <>
            <button className="ce-tool-btn" title="Сбросить изменения" onClick={resetChanges}>
              <RotateCcw size={14} />
            </button>
            <button
              className="ce-tool-btn save-btn"
              title="Сохранить черновик"
              onClick={() => saveDraft()}
              disabled={saving}
            >
              <Save size={14} />
              <span>{saving ? '…' : 'Сохранить'}</span>
            </button>
          </>
        )}
      </div>

      {toolbarTip && (
        <div
          className={`ce-floating-tooltip ${toolbarTip.placement}`}
          style={{ left: toolbarTip.x, top: toolbarTip.y }}
          role="tooltip"
        >
          {toolbarTip.text}
        </div>
      )}

      {/* ── Layers panel ── */}
      {layerPanelOpen && (
        <div className="ce-layers-panel">
          <div className="ce-layer-lock">
            <span>Конструкции</span>
            <button
              className={`ce-tool-btn mini ${structureLocked ? 'active' : ''}`}
              onClick={toggleStructureLock}
              title={structureLocked ? 'Разблокировать конструкции' : 'Заблокировать конструкции'}
            >
              {structureLocked ? <Lock size={12} /> : <Unlock size={12} />}
            </button>
          </div>
          {[
            ['walls', 'Стены', walls.length],
            ['boundaries', 'Контуры', boundaries.length],
            ['partitions', 'Перегородки', partitions.length],
            ['doors', 'Двери', doors.length],
            ['zones', 'Зоны', zones.length],
            ['desks', 'Объекты', desks.length],
            ['groups', 'Группы', groups.length],
          ].map(([key, label, count]) => (
            <label className="ce-layer-toggle" key={key}>
              <button className="ce-tool-btn mini" onClick={() => toggleLayer(key)}>
                {layerVis[key] ? <Eye size={12} /> : <EyeOff size={12} />}
              </button>
              <span>{label}</span>
              <span className="ce-layer-count">{count}</span>
            </label>
          ))}
          {/* Infra layers section */}
          <div className="ce-layer-sep" />
          <span className="ce-layer-infra-title">Коммуникации</span>
          {infraLayers.map((layer) => (
            <div key={layer.id} className={`ce-infra-chip ${activeInfraLayerId === layer.id ? 'active' : ''}`}>
              <button
                className="ce-tool-btn mini"
                onClick={() => toggleInfraLayerVisibility(layer.id)}
                title={layer.visible ? 'Скрыть' : 'Показать'}
              >
                {layer.visible ? <Eye size={10} /> : <EyeOff size={10} />}
              </button>
              <span className="ce-infra-swatch" style={{ background: layer.color }} />
              <button
                className="ce-infra-name-btn"
                title="Выбрать для рисования"
                onClick={() => {
                  const newId = layer.id === activeInfraLayerId ? null : layer.id;
                  setActiveInfraLayerId(newId);
                  if (newId) { cancelDraw(); setTool('draw_infra'); }
                  else if (tool === 'draw_infra') setTool('select');
                }}
              >
                {layer.name}
              </button>
              <span className="ce-layer-count">{layer.items.length}</span>
              <button
                className="ce-tool-btn mini danger"
                onClick={() => removeInfraLayer(layer.id)}
                title="Удалить слой"
              >
                <X size={10} />
              </button>
            </div>
          ))}
          <select
            value=""
            className="ce-infra-add-select"
            onChange={(e) => {
              const val = e.target.value;
              if (!val) return;
              if (val === '__custom') {
                // eslint-disable-next-line no-alert
                const name = window.prompt('Название слоя:');
                if (name?.trim()) addInfraLayer(name.trim(), '#6366f1');
              } else {
                const preset = INFRA_PRESETS.find((p) => p.name === val);
                if (preset) addInfraLayer(preset.name, preset.color);
              }
              e.target.value = '';
            }}
            title="Добавить слой коммуникаций"
          >
            <option value="">+ слой</option>
            {INFRA_PRESETS.map((p) => <option key={p.name} value={p.name}>{p.name}</option>)}
            <option value="__custom">Свой…</option>
          </select>
        </div>
      )}

      {/* ── Search bar ── */}
      {searchOpen && (
        <div className="ce-search-bar">
          <Search size={14} />
          <input
            autoFocus
            type="text"
            placeholder="Поиск по имени, номеру, сотруднику..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Escape') { setSearchOpen(false); setSearchQuery(''); }
              if (e.key === 'Enter' && searchResults.length) {
                const d = searchResults[0];
                sel.selectOne(d.id);
                viewport.panTo(deskX(d, compMap), deskY(d, compMap));
              }
            }}
          />
          {searchQuery && (
            <span className="ce-search-count">
              {searchResults.length} {pluralRu(searchResults.length, 'найден', 'найдено', 'найдено')}
            </span>
          )}
          {searchResults.length > 0 && (
            <div className="ce-search-results">
              {searchResults.slice(0, 8).map((d) => (
                <button
                  key={d.id}
                  className="ce-search-item"
                  onClick={() => {
                    sel.selectOne(d.id);
                    viewport.panTo(deskX(d, compMap), deskY(d, compMap));
                    setSearchOpen(false);
                    setSearchQuery('');
                  }}
                >
                  <strong>{d.label || d.id}</strong>
                  {d.assigned_to && <span> · {d.assigned_to}</span>}
                </button>
              ))}
            </div>
          )}
        </div>
      )}

      {tool === 'place' && (
        <div className="ce-place-rail">
          <div className="ce-place-summary">
            <span className="ce-place-rail-label">Вставка объекта</span>
            <span className="ce-place-size-readout">
              {selectedPlaceSize.w}×{selectedPlaceSize.h}
            </span>
          </div>
          <div className="ce-place-cards">
            {componentGroups.map((group) => (
              <div className="ce-place-group" key={group.id}>
                <span className="ce-place-group-label">{group.label}</span>
                <div className="ce-place-group-items">
                  {group.items.map((component) => (
                    <button
                      key={component.id}
                      className={`ce-place-card ${placeComponentId === component.id ? 'active' : ''}`}
                      onClick={() => selectPlaceComponent(component)}
                      title={component.label || component.id}
                    >
                      <span className="ce-place-thumb">
                        <svg
                          viewBox={viewBoxString(component)}
                          xmlns="http://www.w3.org/2000/svg"
                          dangerouslySetInnerHTML={{ __html: componentMarkup(component) }}
                        />
                      </span>
                      <span>{component.label || component.id}</span>
                    </button>
                  ))}
                </div>
              </div>
            ))}
          </div>
          <div className="ce-place-controls">
            <div className="ce-size-segment" role="group" aria-label="Размер объекта">
              {PLACE_SIZE_MODES.map((mode) => (
                <button
                  key={mode.id}
                  type="button"
                  className={placeSizeMode === mode.id ? 'active' : ''}
                  onClick={() => setPlaceSizeMode(mode.id)}
                >
                  {mode.label}
                </button>
              ))}
            </div>
            {placeSizeMode === 'custom' && (
              <div className="ce-custom-size">
                <input
                  type="number"
                  min="10"
                  value={placeCustomSize.w}
                  onChange={(e) => setPlaceCustomSize((prev) => ({ ...prev, w: Number(e.target.value) }))}
                  aria-label="Ширина объекта"
                />
                <span>×</span>
                <input
                  type="number"
                  min="10"
                  value={placeCustomSize.h}
                  onChange={(e) => setPlaceCustomSize((prev) => ({ ...prev, h: Number(e.target.value) }))}
                  aria-label="Высота объекта"
                />
              </div>
            )}
            <div className="ce-place-preview">
              <svg
                viewBox={viewBoxString(selectedPlaceComponent)}
                xmlns="http://www.w3.org/2000/svg"
                dangerouslySetInnerHTML={{ __html: componentMarkup(selectedPlaceComponent) }}
              />
            </div>
            <span className="ce-place-rail-hint">Кликайте по холсту. Escape завершит вставку.</span>
          </div>
        </div>
      )}

      {/* ── Hotkeys panel ── */}
      {kbdPanelOpen && (
        <div className="ce-kbd-panel">
          <div className="ce-kbd-panel-header">
            <span>Горячие клавиши</span>
            <button className="ce-tool-btn mini" onClick={() => setKbdPanelOpen(false)} title="Закрыть">
              <X size={12} />
            </button>
          </div>
          <div className="ce-kbd-grid">
            {[
              ['V', 'Выбор объекта'],
              ['Space', 'Навигация (зажать)'],
              ['P', 'Добавить объект'],
              ['M', 'Линейка'],
              ['W', 'Рисовать стену'],
              ['Z', 'Рисовать зону'],
              ['I', 'Рисовать коммуникацию'],
              ['F', 'Показать всё на экране'],
              ['L', 'Зафиксировать/отпустить объекты'],
              ['Enter', 'Завершить линию'],
              ['Esc', 'Отменить / снять выделение'],
              ['Del / Backspace', 'Удалить выбранное'],
              ['Ctrl+Z', 'Отменить (Undo)'],
              ['Ctrl+Shift+Z', 'Повторить (Redo)'],
              ['Ctrl+C', 'Копировать'],
              ['Ctrl+V', 'Вставить'],
              ['Ctrl+D', 'Дублировать'],
              ['Ctrl+G', 'Сгруппировать'],
              ['Ctrl+F', 'Поиск по объектам'],
              ['Shift+прокрутка', 'Горизонтальный скролл'],
              ['?', 'Открыть/закрыть эту подсказку'],
            ].map(([key, label]) => (
              <div key={key} className="ce-kbd-row">
                <kbd className="ce-kbd-key">{key}</kbd>
                <span>{label}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ── Canvas resize panel ── */}
      {canvasResizeOpen && (
        <div className="ce-canvas-resize-panel">
          <div className="ce-canvas-resize-header">
            <span><Maximize2 size={13} style={{ verticalAlign: 'middle', marginRight: 4 }} />Размер холста</span>
            <button className="ce-tool-btn mini" onClick={() => setCanvasResizeOpen(false)} title="Закрыть">
              <X size={12} />
            </button>
          </div>
          <div className="ce-canvas-resize-presets">
            {CANVAS_PRESETS.map((p) => (
              <button
                key={p.label}
                className={`ce-canvas-preset-btn${canvasW === p.w && canvasH === p.h ? ' active' : ''}`}
                onClick={() => applyCanvasResize(p.w, p.h)}
              >
                {p.label}
              </button>
            ))}
          </div>
          <div className="ce-canvas-resize-custom">
            <label>
              W
              <input
                type="text"
                inputMode="numeric"
                pattern="[0-9]*"
                className={`ce-canvas-dim-input${canvasResizeParsed.w === null ? ' invalid' : ''}`}
                value={canvasResizeInput.w}
                onChange={(e) => setCanvasResizeInput((prev) => ({ ...prev, w: sanitizeCanvasDim(e.target.value) }))}
                onKeyDown={(e) => { if (e.key === 'Enter' && canvasResizeValid) applyCanvasResize(canvasResizeInput.w, canvasResizeInput.h); }}
              />
            </label>
            <span className="ce-canvas-resize-x">×</span>
            <label>
              H
              <input
                type="text"
                inputMode="numeric"
                pattern="[0-9]*"
                className={`ce-canvas-dim-input${canvasResizeParsed.h === null ? ' invalid' : ''}`}
                value={canvasResizeInput.h}
                onChange={(e) => setCanvasResizeInput((prev) => ({ ...prev, h: sanitizeCanvasDim(e.target.value) }))}
                onKeyDown={(e) => { if (e.key === 'Enter' && canvasResizeValid) applyCanvasResize(canvasResizeInput.w, canvasResizeInput.h); }}
              />
            </label>
            <button
              className="ce-canvas-resize-apply"
              disabled={!canvasResizeValid}
              onClick={() => applyCanvasResize(canvasResizeInput.w, canvasResizeInput.h)}
            >
              ОК
            </button>
          </div>
          <div className="ce-canvas-resize-current">
            Текущий: {canvasW}×{canvasH} · {canvasResizeHint} · зум сохранится
          </div>
        </div>
      )}

      {/* ── Hint bar ── */}
      {isDrawMode && (
        <div className="ce-hint-bar">
          Рисование:{' '}
          <strong>
            {drawStructType === 'infra'
              ? (infraLayers.find((l) => l.id === activeInfraLayerId)?.name || 'коммуникации')
              : structureLabel(drawStructType).toLowerCase()}
          </strong>
          {' '}— кликом добавляйте точки
          {isZoneDrawMode
            ? (drawPoints.length >= 3
                ? ', нажмите у первой точки чтобы замкнуть'
                : ` (нужно ${Math.max(0, 3 - drawPoints.length)} ещё)`)
            : (drawPoints.length >= 2 && ', двойной клик или Enter завершит линию')
          }
          {drawPoints.length > 0 && ', Escape отменит'}
          {!isZoneDrawMode && drawPoints.length > 0 && ', Shift держит горизонталь/вертикаль'}
          {drawIssue?.text && (
            <span className={`ce-draw-issue ${drawIssue.level}`}>{drawIssue.text}</span>
          )}
        </div>
      )}

      {tool === 'measure' && (
        <div className="ce-hint-bar">
          Линейка: кликните две точки
          {measureText ? ` — ${measureText}` : ''}
          {measurePoints.length > 0 && ', Escape очистит'}
        </div>
      )}

      {/* ── No-draft overlay (shown over the canvas when layout is missing) ── */}
      {!layout && (
        <div className="ce-no-draft-overlay">
          <div className="ce-no-draft-body">
            <Layers size={40} strokeWidth={1.2} />
            <p>{floorId ? 'Нет черновика карты' : 'Выберите этаж'}</p>
            {floorId && (
              <p className="ce-no-draft-hint">
                Нажмите «Пустой черновик» в панели выше или загрузите SVG.
              </p>
            )}
          </div>
        </div>
      )}

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
          onDoubleClick={onSvgDoubleClick}
        >
          {/* Canvas background */}
          <rect className="ce-bg" width={canvasW} height={canvasH} />

          {/* Tracing background image */}
          {bgImage && bgVisible && (
            <g transform={`rotate(${bgFrame.rotation || 0} ${bgCenter.x} ${bgCenter.y})`}>
              <image
                href={bgImage}
                x={bgFrame.x} y={bgFrame.y}
                width={bgFrame.w} height={bgFrame.h}
                opacity={bgOpacity}
                preserveAspectRatio="none"
                data-bg-action="move"
                style={{ pointerEvents: tool === 'bg_edit' && !bgLocked ? 'visiblePainted' : 'none', cursor: 'move' }}
              />
            </g>
          )}

          {bgImage && bgVisible && (tool === 'bg_edit' || tool === 'bg_calibrate') && (
            <g className="ce-bg-controls">
              <polygon
                points={bgFramePoints}
                fill="rgba(37, 99, 235, 0.04)"
                stroke={bgLocked ? '#94a3b8' : '#2563eb'}
                strokeWidth={viewport.worldUnitsForPx(1.5)}
                strokeDasharray={`${viewport.worldUnitsForPx(6)} ${viewport.worldUnitsForPx(4)}`}
                data-bg-action="move"
                style={{ pointerEvents: tool === 'bg_edit' && !bgLocked ? 'visiblePainted' : 'none', cursor: bgLocked ? 'default' : 'move' }}
              />
              {tool === 'bg_edit' && !bgLocked && ['nw', 'ne', 'sw', 'se'].map((corner) => (
                <rect
                  key={corner}
                  className="ce-bg-handle"
                  data-bg-action="resize"
                  data-bg-corner={corner}
                  x={bgHandles[corner].x - viewport.worldUnitsForPx(5)}
                  y={bgHandles[corner].y - viewport.worldUnitsForPx(5)}
                  width={viewport.worldUnitsForPx(10)}
                  height={viewport.worldUnitsForPx(10)}
                  rx={viewport.worldUnitsForPx(2)}
                />
              ))}
              {tool === 'bg_edit' && !bgLocked && (
                <>
                  <line
                    x1={bgHandles.n.x}
                    y1={bgHandles.n.y}
                    x2={bgHandles.rotate.x}
                    y2={bgHandles.rotate.y}
                    stroke="#2563eb"
                    strokeWidth={viewport.worldUnitsForPx(1)}
                  />
                  <circle
                    className="ce-bg-rotate-handle"
                    data-bg-action="rotate"
                    cx={bgHandles.rotate.x}
                    cy={bgHandles.rotate.y}
                    r={viewport.worldUnitsForPx(7)}
                  />
                </>
              )}
            </g>
          )}

          {bgImage && bgVisible && (tool === 'bg_calibrate' || bgCalibrationPoints.length > 0) && (
            <g className="ce-bg-calibration">
              {bgCalibrationPoints.length >= 2 && (
                <line
                  x1={bgCalibrationPoints[0].x}
                  y1={bgCalibrationPoints[0].y}
                  x2={bgCalibrationPoints[1].x}
                  y2={bgCalibrationPoints[1].y}
                  stroke="#dc2626"
                  strokeWidth={viewport.worldUnitsForPx(2)}
                />
              )}
              {bgCalibrationPoints.map((p, i) => (
                <circle
                  key={i}
                  cx={p.x}
                  cy={p.y}
                  r={viewport.worldUnitsForPx(5)}
                  fill="#fff"
                  stroke="#dc2626"
                  strokeWidth={viewport.worldUnitsForPx(2)}
                />
              ))}
            </g>
          )}

          {/* Grid lines layer */}
          {gridLines && (
            <g className="ce-grid">
              {Array.from({ length: gridLines.cols }, (_, i) => {
                const x = i * gridLines.step;
                const isMajor = i % gridLines.majorEvery === 0;
                return (
                  <line
                    key={`gx${i}`}
                    className={isMajor ? 'ce-grid-line-major' : 'ce-grid-line-minor'}
                    x1={x} y1={0}
                    x2={x} y2={canvasH}
                    vectorEffect="non-scaling-stroke"
                  />
                );
              })}
              {Array.from({ length: gridLines.rows }, (_, i) => {
                const y = i * gridLines.step;
                const isMajor = i % gridLines.majorEvery === 0;
                return (
                  <line
                    key={`gy${i}`}
                    className={isMajor ? 'ce-grid-line-major' : 'ce-grid-line-minor'}
                    x1={0} y1={y}
                    x2={canvasW} y2={y}
                    vectorEffect="non-scaling-stroke"
                  />
                );
              })}
            </g>
          )}

          {/* Zones layer — rendered below structure */}
          <g style={{ display: layerVis.zones ? undefined : 'none' }}>
            {zones.map((zone) => {
              const pts = (zone.pts || []);
              if (pts.length < 3) return null;
              const isSel = selectedZoneId === zone.id;
              const color = zone.color || zoneDefaultColor(zone.type);
              // centroid
              const cx = pts.reduce((s, p) => s + p[0], 0) / pts.length;
              const cy = pts.reduce((s, p) => s + p[1], 0) / pts.length;
              return (
                <g key={zone.id} className="ce-zone-visual" data-zone-id={zone.id}>
                  <polygon
                    points={pts.map((p) => `${p[0]},${p[1]}`).join(' ')}
                    fill={color}
                    fillOpacity={0.35}
                    stroke={isSel ? '#2563eb' : color}
                    strokeWidth={isSel ? 2.5 : 1.5}
                    strokeDasharray={isSel ? '6 3' : 'none'}
                    style={{ cursor: 'pointer' }}
                  />
                  <text
                    x={cx} y={cy}
                    textAnchor="middle"
                    dominantBaseline="central"
                    fontSize={13}
                    fontWeight={600}
                    fill={isSel ? '#1d4ed8' : '#374151'}
                    style={{ pointerEvents: 'none', userSelect: 'none' }}
                    fillOpacity={0.8}
                  >
                    {zone.label}
                  </text>
                </g>
              );
            })}
          </g>

          {/* Infra layers rendering */}
          {infraLayers.filter((l) => l.visible).map((layer) => (
            <g key={layer.id}>
              {layer.items.map((item) => {
                const pts = item.pts || [];
                if (pts.length < 2) return null;
                const isSel = selectedInfraItem?.layerId === layer.id && selectedInfraItem?.itemId === item.id;
                return (
                  <g key={item.id}>
                    {/* Wide transparent hit area */}
                    <polyline
                      points={pts.map((p) => `${p[0]},${p[1]}`).join(' ')}
                      fill="none"
                      stroke="transparent"
                      strokeWidth={12}
                      strokeLinecap="round"
                      data-infra-layer={layer.id}
                      data-infra-item={item.id}
                      style={{ cursor: tool === 'select' ? 'pointer' : undefined }}
                    />
                    <polyline
                      points={pts.map((p) => `${p[0]},${p[1]}`).join(' ')}
                      fill="none"
                      stroke={isSel ? '#2563eb' : layer.color}
                      strokeWidth={isSel ? 4 : 2.5}
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      opacity={isSel ? 1 : 0.85}
                      style={{ pointerEvents: 'none' }}
                    />
                  </g>
                );
              })}
            </g>
          ))}

          {/* Zone draw preview */}
          {isZoneDrawMode && drawPoints.length > 0 && (() => {
            const allPts = drawPreviewPt ? [...drawPoints, drawPreviewPt] : drawPoints;
            const color = '#7c3aed';
            return (
              <g className="ce-draw-preview">
                <polygon
                  points={allPts.map((p) => `${p.x},${p.y}`).join(' ')}
                  fill={color}
                  fillOpacity={0.15}
                  stroke={color}
                  strokeWidth={2}
                  strokeDasharray="6 4"
                  strokeLinecap="round"
                />
                {drawPoints.map((p, i) => (
                  <circle key={i} cx={p.x} cy={p.y} r={4} fill="#fff" stroke={color} strokeWidth={1.5} />
                ))}
              </g>
            );
          })()}

          {/* Structure layer */}
          <g
            className={`ce-structure ${structureLocked ? 'locked' : ''}`}
          >
            {layerVis.boundaries && boundaries.map((b, i) => {
              const pts = (b.pts || b.points || []).map(ptFromArr);
              const isSel = !structureLocked && selectedStruct?.type === 'boundary' && selectedStruct?.id === b.id;
              const thick = structureThickness(b, 'boundary');
              return (
                <polygon
                  key={`b${i}`}
                  className="ce-structure-selectable"
                  data-struct-type="boundary"
                  data-struct-id={b.id}
                  points={pts.map((p) => `${p.x},${p.y}`).join(' ')}
                  fill={STRUCT_COLORS.boundary}
                  fillOpacity={STRUCT_OPACITY.boundary}
                  stroke={isSel ? '#2563eb' : STRUCT_COLORS.boundary}
                  strokeWidth={isSel ? thick + 1.5 : thick}
                  strokeDasharray={isSel ? '6 3' : 'none'}
                />
              );
            })}
            {layerVis.partitions && partitions.map((p, i) => {
              const pts = (p.pts || []).map(ptFromArr);
              const isSel = !structureLocked && selectedStruct?.type === 'partition' && selectedStruct?.id === p.id;
              const thick = structureThickness(p, 'partition');
              return (
                <polyline
                  key={`p${i}`}
                  className="ce-structure-selectable"
                  data-struct-type="partition"
                  data-struct-id={p.id}
                  points={pts.map((pt) => `${pt.x},${pt.y}`).join(' ')}
                  fill="none"
                  stroke={isSel ? '#2563eb' : STRUCT_COLORS.partition}
                  strokeOpacity={isSel ? 1 : STRUCT_OPACITY.partition}
                  strokeWidth={isSel ? thick + 2 : thick}
                  strokeLinecap="round"
                  strokeDasharray={isSel ? '6 3' : 'none'}
                />
              );
            })}
            {layerVis.walls && walls.map((w, i) => {
              const pts = (w.pts || []).map(ptFromArr);
              const isSel = !structureLocked && selectedStruct?.type === 'wall' && selectedStruct?.id === w.id;
              const thick = structureThickness(w, 'wall');
              if (pts.length >= 2) {
                return (
                  <polyline
                    key={`w${i}`}
                    className="ce-structure-selectable"
                    data-struct-type="wall"
                    data-struct-id={w.id}
                    points={pts.map((p) => `${p.x},${p.y}`).join(' ')}
                    fill="none"
                    stroke={isSel ? '#2563eb' : STRUCT_COLORS.wall}
                    strokeWidth={isSel ? thick + 2 : thick}
                    strokeLinecap="square"
                    strokeDasharray={isSel ? '6 3' : 'none'}
                  />
                );
              }
              return (
                <line
                  key={`w${i}`}
                  className="ce-structure-selectable"
                  data-struct-type="wall"
                  data-struct-id={w.id}
                  x1={w.x1 || 0} y1={w.y1 || 0}
                  x2={w.x2 || 0} y2={w.y2 || 0}
                  stroke={isSel ? '#2563eb' : STRUCT_COLORS.wall}
                  strokeWidth={isSel ? thick + 2 : thick}
                  strokeDasharray={isSel ? '6 3' : 'none'}
                />
              );
            })}
            {layerVis.doors && doors.map((d, i) => {
              const pts = (d.pts || []).map(ptFromArr);
              const isSel = !structureLocked && selectedStruct?.type === 'door' && selectedStruct?.id === d.id;
              const thick = structureThickness(d, 'door');
              if (pts.length >= 2) {
                return (
                  <polyline
                    key={`d${i}`}
                    className="ce-structure-selectable"
                    data-struct-type="door"
                    data-struct-id={d.id}
                    points={pts.map((p) => `${p.x},${p.y}`).join(' ')}
                    fill="none"
                    stroke={isSel ? '#2563eb' : STRUCT_COLORS.door}
                    strokeWidth={isSel ? thick + 2 : thick}
                    strokeDasharray={isSel ? '6 3' : '6 3'}
                    strokeLinecap="round"
                  />
                );
              }
              return (
                <line
                  key={`d${i}`}
                  className="ce-structure-selectable"
                  data-struct-type="door"
                  data-struct-id={d.id}
                  x1={d.x1 || 0} y1={d.y1 || 0}
                  x2={d.x2 || 0} y2={d.y2 || 0}
                  stroke={isSel ? '#2563eb' : STRUCT_COLORS.door}
                  strokeWidth={isSel ? thick + 2 : thick}
                  strokeDasharray="6 3"
                />
              );
            })}
          </g>

          {/* Vertex handles + segment hit areas for selected structure */}
          {selectedStruct && !structureLocked && (() => {
            const item = getStructList(selectedStruct.type).find((s) => s.id === selectedStruct.id);
            if (!item) return null;
            const pts = (item.pts || item.points || []).map(ptFromArr);
            const handleR = viewport.worldUnitsForPx(5);
            return (
              <g className="ce-vertex-handles">
                {pts.length >= 2 && pts.slice(0, -1).map((a, idx) => {
                  const b = pts[idx + 1];
                  return (
                    <line
                      key={`seg${idx}`}
                      data-seg-idx={idx}
                      data-struct-type={selectedStruct.type}
                      data-struct-id={selectedStruct.id}
                      x1={a.x} y1={a.y} x2={b.x} y2={b.y}
                      stroke="transparent" strokeWidth={Math.max(handleR * 2, 8)}
                      style={{ cursor: 'copy' }}
                    />
                  );
                })}
                {pts.map((p, idx) => (
                  <circle
                    key={`v${idx}`}
                    data-vertex-idx={idx}
                    data-struct-type={selectedStruct.type}
                    data-struct-id={selectedStruct.id}
                    cx={p.x} cy={p.y} r={handleR}
                    fill="#fff" stroke="#2563eb" strokeWidth={Math.max(1.5, handleR * 0.4)}
                    style={{ cursor: 'move' }}
                  />
                ))}
              </g>
            );
          })()}

          {/* Draw preview polyline (not for zone — zone has its own preview above) */}
          {isDrawMode && !isZoneDrawMode && drawPoints.length > 0 && (() => {
            const allPts = drawPreviewPt
              ? [...drawPoints, drawPreviewPt]
              : drawPoints;
            const color = drawStructType === 'infra'
              ? (infraLayers.find((l) => l.id === activeInfraLayerId)?.color || '#f59e0b')
              : (STRUCT_COLORS[drawStructType] || '#2563eb');
            return (
              <g className="ce-draw-preview">
                <polyline
                  className={drawIssue?.level === 'error' ? 'invalid' : ''}
                  points={allPts.map((p) => `${p.x},${p.y}`).join(' ')}
                  fill="none"
                  stroke={color}
                  strokeWidth={drawStructType === 'wall' ? 4 : drawStructType === 'door' ? 2.5 : 3}
                  strokeDasharray={drawPreviewPt ? '6 4' : 'none'}
                  strokeLinecap="round"
                  opacity={0.7}
                />
                {drawPoints.map((p, i) => (
                  <circle
                    key={i}
                    cx={p.x} cy={p.y} r={4}
                    fill="#fff" stroke={color} strokeWidth={1.5}
                  />
                ))}
              </g>
            );
          })()}

          {isDrawMode && drawSnapPt && (
            <g className="ce-snap-marker" transform={`translate(${drawSnapPt.x},${drawSnapPt.y})`}>
              <circle r={7} />
              <path d="M-10 0H-4M4 0H10M0-10V-4M0 4V10" />
            </g>
          )}

          {objectSnapGuides && (
            <g className="ce-object-snap-guides">
              {Number.isFinite(objectSnapGuides.x) && (
                <line x1={objectSnapGuides.x} y1={0} x2={objectSnapGuides.x} y2={canvasH} />
              )}
              {Number.isFinite(objectSnapGuides.y) && (
                <line x1={0} y1={objectSnapGuides.y} x2={canvasW} y2={objectSnapGuides.y} />
              )}
            </g>
          )}

          {/* Desks layer */}
          <g style={{ display: layerVis.desks ? undefined : 'none' }}>
          {desks.map((desk) => {
            const w = deskW(desk, compMap);
            const h = deskH(desk, compMap);
            const x = deskX(desk, compMap);
            const y = deskY(desk, compMap);
            const component = compMap.get(desk.component_id || desk.symbol_id) || compMap.get('desk-short');
            const markup = componentMarkup(component);
            const isSelected = sel.selectedIds.has(desk.id);
            const r = rotationOf(desk);
            const rotate = r ? ` rotate(${r} ${w / 2} ${h / 2})` : '';
            const showLabel = shouldShowObjectLabel(component, desk);
            return (
              <g
                key={desk.id}
                className="ce-desk"
                transform={`translate(${x},${y})${rotate}`}
                data-id={desk.id}
              >
                {markup ? (
                  <svg
                    key={`${desk.component_id || desk.symbol_id}-${markup.length}`}
                    className="ce-desk-art"
                    width={w}
                    height={h}
                    viewBox={viewBoxString(component)}
                    preserveAspectRatio="none"
                    dangerouslySetInnerHTML={{ __html: markup }}
                  />
                ) : (
                  <rect
                    className="ce-desk-body"
                    width={w}
                    height={h}
                    rx={3}
                    fill={isSelected ? '#dbeafe' : deskFill(desk)}
                    stroke={deskStroke(desk, isSelected)}
                    strokeWidth={isSelected ? 2 : 1}
                  />
                )}
                <rect
                  className="ce-desk-hit"
                  width={w}
                  height={h}
                  rx={5}
                  fill={isSelected ? 'rgba(37,99,235,0.08)' : 'transparent'}
                  stroke={isSelected ? '#2563eb' : 'transparent'}
                  strokeWidth={isSelected ? 2 : 1}
                />
                {showLabel && (
                  <text
                    className="ce-desk-label"
                    x={w / 2}
                    y={h / 2}
                    textAnchor="middle"
                    dominantBaseline="central"
                    fontSize={Math.max(8, Math.min(12, w / 8, h / 3))}
                    fill="#334155"
                  >
                    {desk.label || desk.id}
                  </text>
                )}
              </g>
            );
          })}

          </g>

          {/* Group bounding boxes */}
          <g className="ce-group-bbox" style={{ display: layerVis.groups ? undefined : 'none' }}>
            {groups.map((group) => {
              const gDesks = desks.filter((d) => group.desk_ids.includes(d.id));
              if (!gDesks.length) return null;
              let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
              for (const d of gDesks) {
                const dx = deskX(d, compMap), dy = deskY(d, compMap);
                const dw = deskW(d, compMap), dh = deskH(d, compMap);
                if (dx < minX) minX = dx;
                if (dy < minY) minY = dy;
                if (dx + dw > maxX) maxX = dx + dw;
                if (dy + dh > maxY) maxY = dy + dh;
              }
              if (!Number.isFinite(minX)) return null;
              const pad = 8;
              const color = group.color || '#2563eb';
              return (
                <g key={group.id} className="ce-group-visual" data-group-id={group.id}>
                  <rect
                    x={minX - pad} y={minY - pad}
                    width={maxX - minX + pad * 2} height={maxY - minY + pad * 2}
                    rx={6}
                    fill={color}
                    fillOpacity={0.04}
                    stroke={color}
                    strokeWidth={1.5}
                    strokeDasharray="8 4"
                    style={{ cursor: 'pointer', pointerEvents: 'stroke' }}
                  />
                  <text
                    x={minX - pad + 4} y={minY - pad - 4}
                    fontSize={10}
                    fill={color}
                    fontWeight={600}
                    style={{ pointerEvents: 'none', userSelect: 'none' }}
                  >
                    {group.label}
                  </text>
                </g>
              );
            })}
          </g>

          {/* Selection overlay */}
          <g className="ce-selection-overlay">
            {/* Per-desk selected dashes when multi-select */}
            {sel.selectedIds.size > 1 && desks
              .filter((d) => sel.selectedIds.has(d.id))
              .map((desk) => {
                const w = deskW(desk, compMap);
                const h = deskH(desk, compMap);
                const r = rotationOf(desk);
                const rotate = r ? ` rotate(${r} ${w / 2} ${h / 2})` : '';
                return (
                  <rect
                    key={`sel-${desk.id}`}
                    transform={`translate(${deskX(desk, compMap)},${deskY(desk, compMap)})${rotate}`}
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
              const w = deskW(selectedDesk, compMap);
              const h = deskH(selectedDesk, compMap);
              const x = deskX(selectedDesk, compMap);
              const y = deskY(selectedDesk, compMap);
              const r = rotationOf(selectedDesk);
              const rotate = r
                ? ` rotate(${r} ${x + w / 2} ${y + h / 2})`
                : '';
              const handles = [
                [x,     y,     'nwse-resize'],
                [x + w, y,     'nesw-resize'],
                [x,     y + h, 'nesw-resize'],
                [x + w, y + h, 'nwse-resize'],
              ];
              function onHandleDown(corner, e) {
                e.stopPropagation();
                undoRedo.push(snapshot());
                resizeRef.current = {
                  deskId: selectedDesk.id,
                  corner,
                  startPt: viewport.screenToSvg(e),
                  origX: x, origY: y, origW: w, origH: h,
                };
                viewport.svgRef.current?.setPointerCapture(e.pointerId);
              }
              function onRotateDown(e) {
                e.stopPropagation();
                const center = { x: x + w / 2, y: y + h / 2 };
                const startPt = viewport.screenToSvg(e);
                undoRedo.push(snapshot());
                rotateRef.current = {
                  deskId: selectedDesk.id,
                  center,
                  startAngle: Math.atan2(startPt.y - center.y, startPt.x - center.x) * 180 / Math.PI,
                  origR: rotationOf(selectedDesk),
                };
                viewport.svgRef.current?.setPointerCapture(e.pointerId);
              }
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
                  {handles.map(([hx, hy, cursor], i) => (
                    <rect
                      key={i}
                      className="ce-sel-handle"
                      x={hx - 4} y={hy - 4}
                      width={8} height={8}
                      rx={2}
                      style={{ cursor }}
                      onPointerDown={(e) => onHandleDown(i, e)}
                    />
                  ))}
                  <line
                    className="ce-sel-rotate-line"
                    x1={x + w / 2}
                    y1={y - 3}
                    x2={x + w / 2}
                    y2={y - 26}
                  />
                  <circle
                    className="ce-sel-rotate"
                    cx={x + w / 2}
                    cy={y - 30}
                    r={6}
                    onPointerDown={onRotateDown}
                  />
                </g>
              );
            })()}

            {/* Measurement ruler */}
            {measureText && measureMidPoint && (
              <g className="ce-measure-overlay">
                <line
                  className="ce-measure-line"
                  x1={measurePoints[0].x}
                  y1={measurePoints[0].y}
                  x2={measureEndPoint.x}
                  y2={measureEndPoint.y}
                  vectorEffect="non-scaling-stroke"
                />
                {[measurePoints[0], measureEndPoint].map((p, i) => (
                  <circle
                    key={i}
                    className="ce-measure-point"
                    cx={p.x}
                    cy={p.y}
                    r={viewport.worldUnitsForPx(4)}
                    vectorEffect="non-scaling-stroke"
                  />
                ))}
                <text
                  className="ce-measure-label"
                  x={measureMidPoint.x}
                  y={measureMidPoint.y - viewport.worldUnitsForPx(8)}
                  fontSize={viewport.worldUnitsForPx(12)}
                  textAnchor="middle"
                  paintOrder="stroke"
                  strokeWidth={viewport.worldUnitsForPx(4)}
                >
                  {measureText}
                </text>
              </g>
            )}

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

        {/* ── Minimap ── */}
        <Minimap
          canvasW={canvasW}
          canvasH={canvasH}
          vb={viewport.vb}
          desks={desks}
          walls={visibleWalls}
          boundaries={visibleBoundaries}
          onPanTo={viewport.panTo}
        />
      </div>

      {/* ── Background properties panel ── */}
      {bgImage && (tool === 'bg_edit' || tool === 'bg_calibrate' || bgCalibrationPoints.length > 0) && (
        <div className="ce-bg-props">
          <div className="ce-struct-props-header">
            <span>Фон</span>
            <span className="ce-struct-pts-count">
              {bgLocked ? 'зафиксирован' : tool === 'bg_calibrate' ? `${bgCalibrationPoints.length}/2 точки` : 'редактирование'}
            </span>
            <button className="ce-tool-btn mini" title="Вписать фон в холст" onClick={fitBackgroundToCanvas}>
              <Maximize2 size={12} />
            </button>
            <button className="ce-tool-btn mini" title={bgLocked ? 'Разблокировать фон' : 'Зафиксировать фон'} onClick={toggleBackgroundLock}>
              {bgLocked ? <Lock size={12} /> : <Unlock size={12} />}
            </button>
          </div>
          {tool === 'bg_edit' && (
            <div className="ce-bg-transform-panel">
              <label className="ce-prop-row">
                <span>Масштаб</span>
                <button
                  className="ce-tool-btn mini"
                  title="Уменьшить подложку на 10%"
                  disabled={bgLocked}
                  onClick={() => zoomBackgroundBy(0.9)}
                >
                  <ZoomOut size={12} />
                </button>
                <input
                  key={`bg-scale-${bgScalePercent ?? 'none'}`}
                  type="number"
                  min={MIN_BACKGROUND_SCALE_PERCENT}
                  max={MAX_BACKGROUND_SCALE_PERCENT}
                  step="1"
                  defaultValue={bgScalePercent ?? ''}
                  disabled={bgLocked || bgScalePercent === null}
                  onBlur={(e) => applyBackgroundScalePercent(e.currentTarget.value)}
                  onKeyDown={(e) => { if (e.key === 'Enter') e.currentTarget.blur(); }}
                />
                <span className="ce-prop-unit">%</span>
                <button
                  className="ce-tool-btn mini"
                  title="Увеличить подложку на 10%"
                  disabled={bgLocked}
                  onClick={() => zoomBackgroundBy(1.1)}
                >
                  <ZoomIn size={12} />
                </button>
              </label>
              <label className="ce-prop-row">
                <span>Поворот</span>
                <button
                  className="ce-tool-btn mini"
                  title="Повернуть подложку влево на 15°"
                  disabled={bgLocked}
                  onClick={() => rotateBackgroundBy(-15)}
                >
                  <RotateCcw size={12} />
                </button>
                <input
                  key={`bg-rotation-${bgRotationDegrees}`}
                  type="number"
                  min="-180"
                  max="180"
                  step="1"
                  defaultValue={bgRotationDegrees}
                  disabled={bgLocked}
                  onBlur={(e) => applyBackgroundRotation(e.currentTarget.value)}
                  onKeyDown={(e) => { if (e.key === 'Enter') e.currentTarget.blur(); }}
                />
                <span className="ce-prop-unit">°</span>
                <button
                  className="ce-tool-btn mini"
                  title="Повернуть подложку вправо на 15°"
                  disabled={bgLocked}
                  onClick={() => rotateBackgroundBy(15)}
                >
                  <RotateCw size={12} />
                </button>
                <button
                  className="ce-tool-btn mini"
                  title="Сбросить поворот подложки"
                  disabled={bgLocked || bgRotationDegrees === 0}
                  onClick={() => applyBackgroundRotation(0)}
                >
                  0°
                </button>
              </label>
            </div>
          )}
          {tool === 'bg_calibrate' && bgCalibrationPoints.length < 2 && (
            <div className="ce-bg-hint">Укажите две точки с известным расстоянием.</div>
          )}
          {bgCalibrationPoints.length === 2 && (
            <label className="ce-prop-row">
              <span>Длина, м</span>
              <input
                type="number"
                min="0.01"
                step="0.01"
                value={bgCalibrationInput}
                onChange={(e) => setBgCalibrationInput(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter') confirmBackgroundCalibration(); }}
                autoFocus
              />
              <button className="ce-tool-btn mini" title="Применить калибровку" onClick={confirmBackgroundCalibration}>
                <Save size={12} />
              </button>
              <button className="ce-tool-btn mini" title="Отменить калибровку" onClick={cancelBackgroundCalibration}>
                <X size={12} />
              </button>
            </label>
          )}
          {bgCalibration && (
            <div className="ce-bg-hint">
              Калибровано: {bgCalibration.distance_m} м, 1м={pixelsPerMeter}px
            </div>
          )}
        </div>
      )}

      {/* ── Zone properties panel ── */}
      {selectedZoneId && (() => {
        const zone = zones.find((z) => z.id === selectedZoneId);
        if (!zone) return null;
        return (
          <div className="ce-zone-props">
            <div className="ce-zone-props-header">
              <span>Зона</span>
              <button className="ce-tool-btn mini danger" title="Удалить зону (Del)" onClick={() => deleteZone(zone.id)}>
                <Trash2 size={12} />
              </button>
            </div>
            <label className="ce-prop-row">
              <span>Название</span>
              <input
                type="text"
                value={zone.label}
                onChange={(e) => updateZone(zone.id, { label: e.target.value })}
              />
            </label>
            <label className="ce-prop-row">
              <span>Тип</span>
              <select
                value={zone.type}
                onChange={(e) => {
                  const newType = e.target.value;
                  updateZone(zone.id, { type: newType, color: zoneDefaultColor(newType) });
                }}
              >
                {ZONE_TYPES.map((zt) => (
                  <option key={zt.id} value={zt.id}>{zt.label}</option>
                ))}
              </select>
            </label>
            <label className="ce-prop-row">
              <span>Цвет</span>
              <input
                type="color"
                value={zone.color || zoneDefaultColor(zone.type)}
                onChange={(e) => updateZone(zone.id, { color: e.target.value })}
                style={{ width: 36, height: 24, padding: 1, cursor: 'pointer' }}
              />
            </label>
          </div>
        );
      })()}

      {/* ── Structure properties panel ── */}
      {selectedStruct && !structureLocked && (() => {
        const item = getStructList(selectedStruct.type).find((s) => s.id === selectedStruct.id);
        if (!item) return null;
        const thick = structureThickness(item, selectedStruct.type);
        const setter = getStructSetter(selectedStruct.type);
        function patchStruct(patch) {
          setter((prev) => prev.map((s) => s.id === selectedStruct.id ? { ...s, ...patch } : s));
          setDirty(true);
        }
        return (
          <div className="ce-struct-props">
            <div className="ce-struct-props-header">
              <span>{structureLabel(selectedStruct.type)}</span>
              <span className="ce-struct-pts-count">
                {(item.pts || item.points || []).length} точек
              </span>
              <button className="ce-tool-btn mini danger" title="Удалить (Del)" onClick={deleteSelectedStruct}>
                <Trash2 size={12} />
              </button>
            </div>
            <label className="ce-prop-row">
              <span>Толщина</span>
              <input
                type="range"
                min={1} max={24} step={0.5}
                value={thick}
                onChange={(e) => patchStruct({ thick: Number(e.target.value) })}
                style={{ flex: 1, minWidth: 60 }}
              />
              <span className="ce-struct-thick-val">{thick}</span>
            </label>
            {selectedStruct.type === 'boundary' && (
              <label className="ce-prop-row">
                <span>Метка</span>
                <input
                  type="text"
                  value={item.label || ''}
                  placeholder="—"
                  onChange={(e) => patchStruct({ label: e.target.value })}
                  style={{ flex: 1 }}
                />
              </label>
            )}
          </div>
        );
      })()}

      {/* ── Infra item properties panel ── */}
      {selectedInfraItem && (() => {
        const layer = infraLayers.find((l) => l.id === selectedInfraItem.layerId);
        const item = layer?.items.find((i) => i.id === selectedInfraItem.itemId);
        if (!layer || !item) return null;
        return (
          <div className="ce-struct-props">
            <div className="ce-struct-props-header">
              <span
                className="ce-infra-swatch"
                style={{ background: layer.color, width: 12, height: 12 }}
              />
              <span>{layer.name}</span>
              <span className="ce-struct-pts-count">{item.pts.length} точек</span>
              <button
                className="ce-tool-btn mini danger"
                title="Удалить линию (Del)"
                onClick={() => {
                  undoRedo.push(snapshot());
                  setInfraLayers((prev) => prev.map((l) =>
                    l.id === selectedInfraItem.layerId
                      ? { ...l, items: l.items.filter((i) => i.id !== selectedInfraItem.itemId) }
                      : l
                  ));
                  setSelectedInfraItem(null);
                  setDirty(true);
                }}
              >
                <Trash2 size={12} />
              </button>
            </div>
          </div>
        );
      })()}

      {/* ── Properties sidebar ── */}
      <PropertiesPanel
        desks={desks}
        selectedIds={sel.selectedIds}
        components={components}
        groups={groups}
        selectedInGroup={selectedInGroup}
        onUpdate={updateDesk}
        onDelete={(ids) => {
          const idSet = Array.isArray(ids) ? new Set(ids) : sel.selectedIds;
          modifyDesks((prev) => prev.filter((d) => !idSet.has(d.id)));
          sel.clearSelection();
        }}
        onGroupSelected={groupSelected}
        onUngroupSelected={ungroupSelected}
        onUpdateGroup={updateGroup}
        onDeleteGroup={deleteGroup}
        onSelectGroup={selectGroup}
        canGroup={canGroup}
        canUngroup={canUngroup}
        collapsed={propertiesCollapsed}
        onToggleCollapsed={() => setPropertiesCollapsed((prev) => !prev)}
      />

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
          {desks.length} {pluralRu(desks.length, 'объект', 'объекта', 'объектов')}
          {structureCount > 0 &&
            ` · ${structureCount} ${pluralRu(structureCount, 'конструкция', 'конструкции', 'конструкций')}`}
        </span>
        {sel.selectedIds.size > 0 && (
          <>
            <span className="ce-statusbar-sep">·</span>
            <span className="ce-statusbar-item" style={{ color: '#2563eb' }}>
              выбрано: {sel.selectedIds.size}
            </span>
          </>
        )}
        {selectedObjectSizeText && (
          <>
            <span className="ce-statusbar-sep">·</span>
            <span className="ce-statusbar-item" title="Размер выбранного в единицах холста и метрах">
              размер: {selectedObjectSizeText}
            </span>
          </>
        )}
        {selectedStruct && (
          <>
            <span className="ce-statusbar-sep">·</span>
            <span className="ce-statusbar-item" style={{ color: '#2563eb' }}>
              {structureLabel(selectedStruct.type)}
            </span>
          </>
        )}
        {selectedStructLengthText && (
          <>
            <span className="ce-statusbar-sep">·</span>
            <span className="ce-statusbar-item" title="Длина выбранной конструкции">
              длина: {selectedStructLengthText}
            </span>
          </>
        )}
        {measureText && (
          <>
            <span className="ce-statusbar-sep">·</span>
            <span className="ce-statusbar-item ce-measure-readout">
              линейка: {measureText}
            </span>
          </>
        )}
        <>
          <span className="ce-statusbar-sep">·</span>
          <span className="ce-statusbar-item ce-scale-indicator" title="Масштаб: сколько единиц холста приходится на 1 метр">
            <Ruler size={11} style={{ verticalAlign: 'middle', marginRight: 3 }} />
            <PpmInlineEdit
              value={pixelsPerMeter}
              onChange={(v) => { setPixelsPerMeter(v); setDirty(true); }}
            />
          </span>
        </>
        {grid.gridVisible && (
          <>
            <span className="ce-statusbar-sep ce-statusbar-secondary">·</span>
            <span className="ce-statusbar-item ce-statusbar-secondary" title="Метрическая сетка: малый шаг / большой шаг">
              сетка: {formatMeters(metricGridStep, pixelsPerMeter)} м / {formatMeters(metricGridStep * METRIC_GRID_DIVISIONS, pixelsPerMeter)} м
            </span>
          </>
        )}
        <>
          <span className="ce-statusbar-sep ce-statusbar-secondary">·</span>
          <span className="ce-statusbar-item ce-statusbar-secondary" style={{ opacity: 0.6 }}>
            {canvasW}×{canvasH}
          </span>
        </>
        {dirty && (
          <>
            <span className="ce-statusbar-sep">·</span>
            <span className="ce-statusbar-item" style={{ color: '#d97706' }}>не сохранено</span>
          </>
        )}
      </div>
    </div>
  );
});

export default CanvasEditor;
