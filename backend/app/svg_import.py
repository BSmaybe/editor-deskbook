"""Classify SVG elements into floor structure categories (walls/boundaries/partitions).

Uses only stdlib — no external deps.
"""
from __future__ import annotations

import re
import uuid
import xml.etree.ElementTree as ET
from typing import Optional

from . import schemas

_SVG_NS = "http://www.w3.org/2000/svg"


def _local(tag: str) -> str:
    return tag.split("}")[-1] if "}" in tag else tag


def _attr(el: ET.Element, name: str) -> Optional[str]:
    return el.get(name) or el.get(f"{{{_SVG_NS}}}{name}")


def _stroke_width(el: ET.Element) -> float:
    """Extract stroke-width from element or style attr."""
    sw = el.get("stroke-width")
    if sw is None:
        style = el.get("style", "")
        m = re.search(r"stroke-width\s*:\s*([\d.]+)", style)
        if m:
            sw = m.group(1)
    try:
        return float(sw) if sw else 1.0
    except ValueError:
        return 1.0


def _has_fill(el: ET.Element) -> bool:
    fill = el.get("fill", "")
    style = el.get("style", "")
    if "fill:none" in style or "fill: none" in style:
        return False
    if fill in ("none", ""):
        return False
    return True


def _parse_viewbox(root: ET.Element) -> list[float]:
    vb = root.get("viewBox") or root.get("viewbox") or ""
    parts = re.split(r"[\s,]+", vb.strip())
    try:
        if len(parts) >= 4:
            return [float(p) for p in parts[:4]]
    except ValueError:
        pass
    w = float(root.get("width") or 1000)
    h = float(root.get("height") or 1000)
    return [0.0, 0.0, w, h]


def _line_pts(el: ET.Element) -> list[list[float]]:
    try:
        x1 = float(el.get("x1") or 0)
        y1 = float(el.get("y1") or 0)
        x2 = float(el.get("x2") or 0)
        y2 = float(el.get("y2") or 0)
        return [[x1, y1], [x2, y2]]
    except (TypeError, ValueError):
        return []


def _polyline_pts(el: ET.Element) -> list[list[float]]:
    pts_str = el.get("points") or ""
    nums = re.split(r"[\s,]+", pts_str.strip())
    result: list[list[float]] = []
    i = 0
    while i + 1 < len(nums):
        try:
            result.append([float(nums[i]), float(nums[i + 1])])
        except ValueError:
            pass
        i += 2
    return result


def _rect_pts(el: ET.Element) -> list[list[float]]:
    try:
        x = float(el.get("x") or 0)
        y = float(el.get("y") or 0)
        w = float(el.get("width") or 0)
        h = float(el.get("height") or 0)
        return [[x, y], [x + w, y], [x + w, y + h], [x, y + h]]
    except (TypeError, ValueError):
        return []


def _path_is_closed(d: str) -> bool:
    return bool(re.search(r"[Zz]\s*$", d.strip()))


def _path_approx_pts(d: str) -> list[list[float]]:
    """Very rough M/L/H/V extraction for straight-line paths only."""
    pts: list[list[float]] = []
    cx, cy = 0.0, 0.0
    tokens = re.findall(r"[MmLlHhVvZz]|[-+]?\d*\.?\d+(?:[eE][-+]?\d+)?", d)
    cmd = ""
    nums: list[float] = []

    def flush():
        nonlocal cx, cy
        if not nums:
            return
        if cmd in ("M", "L"):
            i = 0
            while i + 1 < len(nums):
                cx, cy = nums[i], nums[i + 1]
                pts.append([cx, cy])
                i += 2
        elif cmd == "m":
            i = 0
            while i + 1 < len(nums):
                cx += nums[i]; cy += nums[i + 1]
                pts.append([cx, cy])
                i += 2
        elif cmd == "l":
            i = 0
            while i + 1 < len(nums):
                cx += nums[i]; cy += nums[i + 1]
                pts.append([cx, cy])
                i += 2
        elif cmd in ("H",):
            for v in nums:
                cx = v; pts.append([cx, cy])
        elif cmd in ("h",):
            for v in nums:
                cx += v; pts.append([cx, cy])
        elif cmd in ("V",):
            for v in nums:
                cy = v; pts.append([cx, cy])
        elif cmd in ("v",):
            for v in nums:
                cy += v; pts.append([cx, cy])

    for t in tokens:
        if re.match(r"[MmLlHhVvZz]", t):
            flush()
            nums = []
            cmd = t
        else:
            try:
                nums.append(float(t))
            except ValueError:
                pass
    flush()
    return pts


def _length(pts: list[list[float]]) -> float:
    total = 0.0
    for i in range(1, len(pts)):
        dx = pts[i][0] - pts[i - 1][0]
        dy = pts[i][1] - pts[i - 1][1]
        total += (dx * dx + dy * dy) ** 0.5
    return total


def _bbox_area(pts: list[list[float]]) -> float:
    if not pts:
        return 0.0
    xs = [p[0] for p in pts]
    ys = [p[1] for p in pts]
    return (max(xs) - min(xs)) * (max(ys) - min(ys))


def classify_svg(raw_svg: str) -> schemas.ImportResult:
    """Parse an SVG string and classify elements into structure categories."""
    # Reject DOCTYPE/ENTITY before parsing
    if "<!DOCTYPE" in raw_svg or "<!ENTITY" in raw_svg:
        raise ValueError("DOCTYPE/ENTITY not allowed")
    if len(raw_svg.encode()) > 5 * 1024 * 1024:
        raise ValueError("SVG too large (max 5 MB)")

    try:
        root = ET.fromstring(raw_svg)
    except ET.ParseError as exc:
        raise ValueError(f"SVG parse error: {exc}") from exc

    if _local(root.tag) != "svg":
        raise ValueError("Root element must be <svg>")

    vb = _parse_viewbox(root)
    vb_area = vb[2] * vb[3] if vb[2] and vb[3] else 1e6

    walls: list[schemas.StructureElement] = []
    boundaries: list[schemas.StructureElement] = []
    partitions: list[schemas.StructureElement] = []
    uncertain: list[schemas.StructureElement] = []
    skipped = 0

    for el in root.iter():
        tag = _local(el.tag)
        pts: list[list[float]] = []
        closed = False

        if tag == "line":
            pts = _line_pts(el)
        elif tag == "polyline":
            pts = _polyline_pts(el)
        elif tag == "polygon":
            pts = _polyline_pts(el)
            closed = True
        elif tag == "rect":
            pts = _rect_pts(el)
            closed = True
        elif tag == "path":
            d = el.get("d") or ""
            pts = _path_approx_pts(d)
            closed = _path_is_closed(d)
        else:
            if tag not in ("svg", "g", "defs", "title", "desc"):
                skipped += 1
            continue

        if len(pts) < 2:
            skipped += 1
            continue

        sw = _stroke_width(el)
        has_fill = _has_fill(el)
        length = _length(pts)
        area = _bbox_area(pts)
        uid = str(uuid.uuid4())

        el_data = schemas.StructureElement(id=uid, pts=pts, closed=closed)

        # Classification heuristics
        if closed and has_fill and area > vb_area * 0.001:
            # Likely a room boundary
            el_data.thick = 2.0
            el_data.closed = True
            el_data.conf = 0.8 if area > vb_area * 0.01 else 0.6
            boundaries.append(el_data)

        elif closed and not has_fill:
            # Closed outline — boundary
            el_data.thick = sw if sw > 0 else 2.0
            el_data.closed = True
            el_data.conf = 0.75
            boundaries.append(el_data)

        elif not closed and sw >= 4.0:
            # Heavy stroke — wall
            el_data.thick = sw
            el_data.conf = 0.9 if sw >= 6 else 0.8
            walls.append(el_data)

        elif not closed and 1.5 <= sw < 4.0:
            # Medium stroke — partition
            el_data.thick = sw
            el_data.conf = 0.8
            partitions.append(el_data)

        elif not closed and sw < 1.5:
            # Thin line — uncertain (could be grid lines, annotations)
            if length > (vb[2] + vb[3]) * 0.05:
                el_data.thick = 1.0
                el_data.conf = 0.4
                uncertain.append(el_data)
            else:
                skipped += 1

        else:
            el_data.conf = 0.5
            uncertain.append(el_data)

    stats = schemas.ImportStats(
        total_elements=len(walls) + len(boundaries) + len(partitions) + len(uncertain) + skipped,
        walls=len(walls),
        boundaries=len(boundaries),
        partitions=len(partitions),
        uncertain=len(uncertain),
        skipped=skipped,
    )

    return schemas.ImportResult(
        walls=walls,
        boundaries=boundaries,
        partitions=partitions,
        uncertain=uncertain,
        stats=stats,
        vb=vb,
    )
