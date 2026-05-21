import { describe, it, expect } from 'vitest';
import {
  pointInRect,
  pointInEllipse,
  pointSegmentDistance,
  pointNearLine,
  pointInPolygon,
  rectPointDistance,
  rectsIntersect,
  findObjectAtPoint,
} from '../hitTest.js';

describe('pointInRect', () => {
  it('returns true for point inside', () => {
    expect(pointInRect(5, 5, 0, 0, 10, 10)).toBe(true);
  });
  it('returns true for point on edge', () => {
    expect(pointInRect(0, 5, 0, 0, 10, 10)).toBe(true);
    expect(pointInRect(10, 5, 0, 0, 10, 10)).toBe(true);
  });
  it('returns false for point outside', () => {
    expect(pointInRect(15, 5, 0, 0, 10, 10)).toBe(false);
    expect(pointInRect(5, -1, 0, 0, 10, 10)).toBe(false);
  });
});

describe('pointInEllipse', () => {
  it('returns true for centre point', () => {
    expect(pointInEllipse(5, 5, 5, 5, 3, 3)).toBe(true);
  });
  it('returns true for point inside', () => {
    expect(pointInEllipse(6, 5, 5, 5, 3, 3)).toBe(true);
  });
  it('returns false for point outside', () => {
    expect(pointInEllipse(10, 5, 5, 5, 3, 3)).toBe(false);
  });
  it('returns false for zero radius', () => {
    expect(pointInEllipse(5, 5, 5, 5, 0, 3)).toBe(false);
    expect(pointInEllipse(5, 5, 5, 5, 3, 0)).toBe(false);
  });
});

describe('pointSegmentDistance', () => {
  it('returns 0 for point on segment', () => {
    expect(pointSegmentDistance(5, 0, 0, 0, 10, 0)).toBeCloseTo(0);
  });
  it('measures perpendicular distance', () => {
    expect(pointSegmentDistance(5, 3, 0, 0, 10, 0)).toBeCloseTo(3);
  });
  it('clamps to nearest endpoint when past end', () => {
    expect(pointSegmentDistance(15, 0, 0, 0, 10, 0)).toBeCloseTo(5);
    expect(pointSegmentDistance(-5, 0, 0, 0, 10, 0)).toBeCloseTo(5);
  });
  it('handles degenerate zero-length segment', () => {
    expect(pointSegmentDistance(3, 4, 0, 0, 0, 0)).toBeCloseTo(5);
  });
});

describe('pointNearLine', () => {
  it('returns true within tolerance', () => {
    expect(pointNearLine(5, 2, 0, 0, 10, 0, 3)).toBe(true);
  });
  it('returns false outside tolerance', () => {
    expect(pointNearLine(5, 5, 0, 0, 10, 0, 3)).toBe(false);
  });
});

describe('pointInPolygon', () => {
  // Square polygon — easier to reason about than triangle
  const square = [[0, 0], [10, 0], [10, 10], [0, 10]];

  it('returns true for point inside square', () => {
    expect(pointInPolygon(5, 5, square)).toBe(true);
  });
  it('returns false for point outside square', () => {
    expect(pointInPolygon(15, 5, square)).toBe(false);
    expect(pointInPolygon(5, 15, square)).toBe(false);
  });
  it('returns false for fewer than 3 points', () => {
    expect(pointInPolygon(1, 1, [[0, 0], [10, 0]])).toBe(false);
  });
  it('accepts object-format points {x,y}', () => {
    const objSquare = [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }, { x: 0, y: 10 }];
    expect(pointInPolygon(5, 5, objSquare)).toBe(true);
    expect(pointInPolygon(15, 5, objSquare)).toBe(false);
  });
  it('returns false for null/empty', () => {
    expect(pointInPolygon(5, 5, null)).toBe(false);
    expect(pointInPolygon(5, 5, [])).toBe(false);
  });
});

describe('rectPointDistance', () => {
  it('returns 0 for point inside rect', () => {
    expect(rectPointDistance(5, 5, 0, 0, 10, 10)).toBe(0);
  });
  it('returns distance for point outside rect', () => {
    expect(rectPointDistance(15, 5, 0, 0, 10, 10)).toBeCloseTo(5);
    expect(rectPointDistance(5, 15, 0, 0, 10, 10)).toBeCloseTo(5);
  });
  it('returns diagonal distance for corner case', () => {
    expect(rectPointDistance(13, 14, 0, 0, 10, 10)).toBeCloseTo(5);
  });
});

describe('rectsIntersect', () => {
  it('returns true for overlapping rects', () => {
    expect(rectsIntersect(0, 0, 10, 10, 5, 5, 10, 10)).toBe(true);
  });
  it('returns true for edge-touching rects', () => {
    expect(rectsIntersect(0, 0, 10, 10, 10, 0, 10, 10)).toBe(true);
  });
  it('returns false for non-overlapping rects', () => {
    expect(rectsIntersect(0, 0, 10, 10, 20, 20, 10, 10)).toBe(false);
  });
  it('returns false when separated horizontally', () => {
    expect(rectsIntersect(0, 0, 5, 10, 10, 0, 5, 10)).toBe(false);
  });
});

describe('findObjectAtPoint', () => {
  const layout = {
    desks: [{ id: 'desk-1', x: 0, y: 0, w: 100, h: 60 }],
    walls: [{ id: 'wall-1', pts: [[0, 100], [200, 100]], closed: false }],
    boundaries: [],
    partitions: [],
    doors: [],
  };

  it('finds desk at point inside it', () => {
    const result = findObjectAtPoint({ x: 50, y: 30 }, layout);
    expect(result).toEqual({ type: 'desk', id: 'desk-1' });
  });

  it('finds wall near point', () => {
    const result = findObjectAtPoint({ x: 100, y: 105 }, layout, 10);
    expect(result).toEqual({ type: 'wall', id: 'wall-1' });
  });

  it('returns null for miss', () => {
    expect(findObjectAtPoint({ x: 500, y: 500 }, layout)).toBeNull();
  });

  it('returns null for null inputs', () => {
    expect(findObjectAtPoint(null, layout)).toBeNull();
    expect(findObjectAtPoint({ x: 50, y: 30 }, null)).toBeNull();
  });
});
