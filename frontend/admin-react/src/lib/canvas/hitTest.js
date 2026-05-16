/**
 * hitTest.js — pure geometry functions for canvas hit-testing.
 *
 * All functions operate in SVG user-unit space.
 * Mirrors the geometry used in editor.js (pointInPolygon, pointSegmentDistance,
 * rectPointDistance, findNearestObjectAtPoint).
 *
 * No React — importable anywhere.
 */

/* ── primitives ── */

/**
 * Test whether point (px, py) is inside axis-aligned rectangle.
 *
 * @param {number} px
 * @param {number} py
 * @param {number} rx  — rect left
 * @param {number} ry  — rect top
 * @param {number} rw  — rect width
 * @param {number} rh  — rect height
 * @returns {boolean}
 */
export function pointInRect(px, py, rx, ry, rw, rh) {
  return px >= rx && px <= rx + rw && py >= ry && py <= ry + rh;
}

/**
 * Test whether point (px, py) is inside an axis-aligned ellipse.
 *
 * @param {number} px
 * @param {number} py
 * @param {number} cx  — centre x
 * @param {number} cy  — centre y
 * @param {number} rx  — x radius
 * @param {number} ry  — y radius
 * @returns {boolean}
 */
export function pointInEllipse(px, py, cx, cy, rx, ry) {
  if (rx <= 0 || ry <= 0) return false;
  const dx = (px - cx) / rx;
  const dy = (py - cy) / ry;
  return dx * dx + dy * dy <= 1;
}

/**
 * Shortest distance from point (px, py) to line segment (ax,ay)→(bx,by).
 * Mirrors editor.js pointSegmentDistance().
 */
export function pointSegmentDistance(px, py, ax, ay, bx, by) {
  const abx = bx - ax;
  const aby = by - ay;
  const apx = px - ax;
  const apy = py - ay;
  const den = abx * abx + aby * aby;
  if (den <= 1e-9) return Math.hypot(px - ax, py - ay);
  const t = Math.max(0, Math.min(1, (apx * abx + apy * aby) / den));
  return Math.hypot(px - (ax + abx * t), py - (ay + aby * t));
}

/**
 * Test whether point is within `tolerance` units of line segment.
 *
 * @param {number} px
 * @param {number} py
 * @param {number} ax
 * @param {number} ay
 * @param {number} bx
 * @param {number} by
 * @param {number} tolerance — in SVG user-units
 * @returns {boolean}
 */
export function pointNearLine(px, py, ax, ay, bx, by, tolerance) {
  return pointSegmentDistance(px, py, ax, ay, bx, by) <= tolerance;
}

/**
 * Ray-casting point-in-polygon test (works for convex and concave polygons).
 * Points are [[x,y], ...] or [{x,y}, ...].
 * Mirrors editor.js pointInPolygon().
 *
 * @param {number} px
 * @param {number} py
 * @param {Array}  pts
 * @returns {boolean}
 */
export function pointInPolygon(px, py, pts) {
  if (!Array.isArray(pts) || pts.length < 3) return false;
  let inside = false;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const xi = Array.isArray(pts[i]) ? Number(pts[i][0]) : Number(pts[i].x ?? 0);
    const yi = Array.isArray(pts[i]) ? Number(pts[i][1]) : Number(pts[i].y ?? 0);
    const xj = Array.isArray(pts[j]) ? Number(pts[j][0]) : Number(pts[j].x ?? 0);
    const yj = Array.isArray(pts[j]) ? Number(pts[j][1]) : Number(pts[j].y ?? 0);
    const crosses = ((yi > py) !== (yj > py)) &&
      (px < ((xj - xi) * (py - yi)) / Math.max(1e-9, yj - yi) + xi);
    if (crosses) inside = !inside;
  }
  return inside;
}

/**
 * Shortest distance from point to axis-aligned rectangle boundary (or 0 if inside).
 * Mirrors editor.js rectPointDistance().
 */
export function rectPointDistance(px, py, rx, ry, rw, rh) {
  const dx = px < rx ? rx - px : (px > rx + rw ? px - (rx + rw) : 0);
  const dy = py < ry ? ry - py : (py > ry + rh ? py - (ry + rh) : 0);
  return Math.hypot(dx, dy);
}

/* ── rect × rect ── */

/**
 * Test whether two axis-aligned rectangles intersect (inclusive of edges).
 * Used for marquee selection.
 */
export function rectsIntersect(ax, ay, aw, ah, bx, by, bw, bh) {
  return ax <= bx + bw && ax + aw >= bx && ay <= by + bh && ay + ah >= by;
}

/* ── composite hit-test ── */

/**
 * Find the topmost desk (or structure element) at a given SVG point.
 *
 * Priority: desks first (exact + threshold), then structures.
 * Mirrors editor.js findNearestObjectAtPoint().
 *
 * @param {{ x: number, y: number }} pt — SVG coords
 * @param {object} layout — { desks, walls, boundaries, partitions, doors }
 * @param {number} thresholdWorldUnits — hit radius in SVG user-units
 * @returns {{ type: string, id: string } | null}
 */
export function findObjectAtPoint(pt, layout, thresholdWorldUnits = 14) {
  if (!pt || !layout) return null;
  const thresh = thresholdWorldUnits;
  let best = null;
  let bestDist = Infinity;

  // Desks — rect hit test
  for (const d of (layout.desks || [])) {
    const dist = rectPointDistance(pt.x, pt.y, d.x ?? 0, d.y ?? 0, d.w ?? 100, d.h ?? 60);
    if (dist <= thresh && dist < bestDist) {
      bestDist = dist;
      best = { type: 'desk', id: d.id };
    }
  }

  // Structure polylines / polygons
  const scanStruct = (arr, type) => {
    for (const el of (arr || [])) {
      const pts = Array.isArray(el.pts) ? el.pts : [];
      if (pts.length < 2) continue;

      // Filled closed polygon — inside check wins immediately
      if (el.closed && pointInPolygon(pt.x, pt.y, pts)) {
        if (bestDist > 0) {
          bestDist = 0;
          best = { type, id: el.id };
        }
        continue;
      }

      // Stroke proximity
      let minDist = Infinity;
      const lim = el.closed ? pts.length : pts.length - 1;
      for (let i = 0; i < lim; i++) {
        const a = pts[i];
        const b = pts[(i + 1) % pts.length];
        const ax = Array.isArray(a) ? Number(a[0]) : Number(a?.x ?? 0);
        const ay = Array.isArray(a) ? Number(a[1]) : Number(a?.y ?? 0);
        const bx = Array.isArray(b) ? Number(b[0]) : Number(b?.x ?? 0);
        const by = Array.isArray(b) ? Number(b[1]) : Number(b?.y ?? 0);
        const d = pointSegmentDistance(pt.x, pt.y, ax, ay, bx, by);
        if (d < minDist) minDist = d;
      }
      if (minDist <= thresh && minDist < bestDist) {
        bestDist = minDist;
        best = { type, id: el.id };
      }
    }
  };

  scanStruct(layout.boundaries, 'boundary');
  scanStruct(layout.walls, 'wall');
  scanStruct(layout.partitions, 'partition');
  scanStruct(layout.doors, 'door');

  return best;
}
