package exporter

import (
	"bytes"
	"encoding/json"
	"encoding/xml"
	"fmt"
	"html"
	"io"
	"math"
	"regexp"
	"sort"
	"strconv"
	"strings"
)

const (
	defaultBuildingID = "building-default"
	defaultStoreyID   = "storey-default"
	defaultZoneID     = "zone-default"
)

type componentMeta struct {
	AssetType string
	ViewBox   [4]float64
	DefaultW  float64
	DefaultH  float64
	Source    string
}

type attr struct {
	name  string
	value string
}

var builtinComponents = map[string]componentMeta{
	"workplace-desk-chair": {AssetType: "workplace", ViewBox: [4]float64{0, 0, 140, 125}, DefaultW: 140, DefaultH: 125, Source: "system"},
	"chair":                {AssetType: "chair", ViewBox: [4]float64{0, 0, 64, 64}, DefaultW: 64, DefaultH: 64, Source: "system"},
	"desk-short":           {AssetType: "desk", ViewBox: [4]float64{0, 0, 100, 60}, DefaultW: 100, DefaultH: 60, Source: "system"},
	"desk-long":            {AssetType: "desk", ViewBox: [4]float64{0, 0, 160, 60}, DefaultW: 160, DefaultH: 60, Source: "system"},
	"meeting-table":        {AssetType: "meeting_table", ViewBox: [4]float64{0, 0, 140, 90}, DefaultW: 140, DefaultH: 90, Source: "system"},
	"conference-chair":     {AssetType: "chair", ViewBox: [4]float64{0, 0, 64, 64}, DefaultW: 64, DefaultH: 64, Source: "system"},
	"conference-set":       {AssetType: "conference_set", ViewBox: [4]float64{0, 0, 220, 150}, DefaultW: 220, DefaultH: 150, Source: "system"},
}

var builtinOrder = []string{
	"workplace-desk-chair",
	"chair",
	"desk-short",
	"desk-long",
	"meeting-table",
	"conference-chair",
	"conference-set",
}

var (
	safeComponentIDRE = regexp.MustCompile(`^[A-Za-z_][A-Za-z0-9_.:-]{0,119}$`)
	localHrefRE       = regexp.MustCompile(`^#[A-Za-z_][A-Za-z0-9_.:-]{0,119}$`)
	dataImageRE       = regexp.MustCompile(`(?i)^data:image/(png|jpe?g|gif|webp);base64,[A-Za-z0-9+/=]+$`)
	hexColorRE        = regexp.MustCompile(`^#[0-9a-fA-F]{3}([0-9a-fA-F]{3})?$`)
)

var allowedCustomTags = map[string]bool{
	"g": true, "path": true, "rect": true, "circle": true, "ellipse": true,
	"line": true, "polyline": true, "polygon": true, "text": true, "use": true,
}

var allowedCustomAttrs = map[string]bool{
	"class": true, "id": true, "d": true, "x": true, "y": true, "width": true, "height": true,
	"rx": true, "ry": true, "cx": true, "cy": true, "r": true, "x1": true, "y1": true,
	"x2": true, "y2": true, "points": true, "transform": true, "fill": true, "stroke": true,
	"stroke-width": true, "stroke-linecap": true, "stroke-linejoin": true, "stroke-dasharray": true,
	"fill-opacity": true, "stroke-opacity": true, "opacity": true, "font-size": true,
	"font-family": true, "font-weight": true, "text-anchor": true, "dominant-baseline": true,
	"href": true, "xlink:href": true,
}

func ParseLayoutJSON(raw []byte) (LayoutDocument, error) {
	var doc LayoutDocument
	if err := json.Unmarshal(raw, &doc); err != nil {
		return doc, err
	}
	return doc, nil
}

func ValidateSVGFragment(markup string) error {
	_, err := sanitizeSVGFragment(markup)
	return err
}

func RenderSVG(doc LayoutDocument) (string, error) {
	vx, vy, vw, vh := viewBox(doc.ViewBox)
	buildingID := safeData(doc.BuildingID, defaultBuildingID)
	storeyID := safeData(doc.StoreyID, defaultStoreyID)
	baseZoneID := safeData(doc.ZoneID, defaultZoneID)
	componentLookup := buildComponentLookup(doc.Components)

	var b strings.Builder
	w := xmlWriter{b: &b}
	b.WriteString(`<?xml version="1.0" encoding="UTF-8"?>` + "\n")
	w.start("svg",
		a("xmlns", "http://www.w3.org/2000/svg"),
		a("viewBox", numList(vx, vy, vw, vh)),
		a("class", "deskbook-map"),
		a("data-format", "deskbook-semantic-svg"),
		a("data-version", "1"),
		a("data-source", "layout_json"),
	)
	if err := appendDefs(&w, doc.Components); err != nil {
		return "", err
	}
	appendBackground(&w, doc, vx, vy, vw, vh)
	appendStructure(&w, doc)

	w.start("g", a("class", "building"), a("id", buildingID), a("data-building", buildingID))
	w.start("g",
		a("class", "storey"),
		a("id", safeID(buildingID+"-"+storeyID, "storey")),
		a("data-building", buildingID),
		a("data-storey", storeyID),
	)

	// Build group membership lookup: deskID → groupID
	deskGroup := map[string]string{}
	groupByID := map[string]LayoutGroup{}
	for _, g := range doc.Groups {
		groupByID[g.ID] = g
		for _, did := range g.DeskIDs {
			deskGroup[did] = g.ID
		}
	}

	zones := map[string][]LayoutDesk{}
	for _, desk := range doc.Desks {
		zoneID := safeData(firstNonEmpty(desk.ZoneID, doc.ZoneID), baseZoneID)
		zones[zoneID] = append(zones[zoneID], desk)
	}
	if len(zones) == 0 {
		zones[baseZoneID] = nil
	}
	zoneIDs := make([]string, 0, len(zones))
	for zoneID := range zones {
		zoneIDs = append(zoneIDs, zoneID)
	}
	sort.Strings(zoneIDs)
	for _, zoneID := range zoneIDs {
		w.start("g",
			a("class", "zone"),
			a("id", safeID(buildingID+"-"+storeyID+"-"+zoneID, "zone")),
			a("data-building", buildingID),
			a("data-storey", storeyID),
			a("data-zone", zoneID),
		)
		// Render desks, wrapping grouped desks in <g class="group">
		rendered := map[string]bool{}
		openGroup := ""
		for _, desk := range zones[zoneID] {
			gid := deskGroup[desk.ID]
			if gid != openGroup {
				if openGroup != "" {
					w.end("g") // close previous group
				}
				if gid != "" {
					g := groupByID[gid]
					attrs := []attr{a("class", "group"), a("id", safeID(gid, "group")), a("data-label", g.Label)}
					if g.Color != "" {
						attrs = append(attrs, a("data-color", g.Color))
					}
					w.start("g", attrs...)
				}
				openGroup = gid
			}
			appendLayoutObject(&w, desk, buildingID, storeyID, zoneID, componentLookup)
			rendered[desk.ID] = true
		}
		if openGroup != "" {
			w.end("g") // close last group
		}
		w.end("g")
	}

	w.end("g")
	w.end("g")
	w.end("svg")
	return b.String(), nil
}

func RenderHTML(svg string, title string) string {
	body := regexp.MustCompile(`(?i)^\s*<\?xml[^>]*>\s*`).ReplaceAllString(svg, "")
	body = indentBlock(body, "      ")
	if strings.TrimSpace(title) == "" {
		title = "Office Layout"
	}
	return fmt.Sprintf(`<!DOCTYPE html>
<html lang="ru">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>%s</title>
    <style>
      body {
        margin: 0;
        background: #f4f6f8;
        font-family: sans-serif;
      }

      .container {
        display: flex;
        justify-content: center;
        padding: 40px;
      }

      svg.deskbook-map {
        width: min(100%%, 1200px);
        height: auto;
        background: white;
        border-radius: 16px;
        box-shadow: 0 10px 30px rgba(0, 0, 0, 0.1);
      }

      .workplace {
        cursor: pointer;
        transition: filter 0.18s ease, opacity 0.18s ease;
      }

      .workplace:hover,
      .workplace:focus {
        filter: drop-shadow(0 0 5px rgba(37, 99, 235, 0.35));
        opacity: 0.96;
      }

      .workplace:focus {
        outline: 2px solid #2563eb;
        outline-offset: 2px;
      }
    </style>
  </head>
  <body>
    <div class="container">
%s
    </div>

    <script>
      document.querySelectorAll('.workplace').forEach(function (workplace) {
        workplace.addEventListener('click', function () {
          var detail = {
            workplaceId: workplace.dataset.workplaceId || workplace.id,
            deskId:      workplace.dataset.deskId || '',
            label:       workplace.dataset.label || '',
            building:    workplace.dataset.building || '',
            storey:      workplace.dataset.storey || '',
            zone:        workplace.dataset.zone || '',
            symbol:      workplace.dataset.symbol || '',
            componentId: workplace.dataset.componentId || '',
            assetType:   workplace.dataset.assetType || '',
            inventoryNumber: workplace.dataset.inventoryNumber || ''
          };
          window.dispatchEvent(new CustomEvent('deskbook:workplace-click', { detail: detail }));
          console.log('deskbook:workplace-click', detail);
        });
      });
    </script>
  </body>
</html>
`, html.EscapeString(title), body)
}

func appendDefs(w *xmlWriter, components []LayoutComponent) error {
	w.start("defs")
	w.start("style")
	w.text(`
.deskbook-map .structure { pointer-events: none; }
.deskbook-map .workplace { cursor: pointer; }
.deskbook-map .asset { cursor: default; }
.deskbook-map .workplace .asset-fill { fill: #dbeafe; }
.deskbook-map .asset .asset-fill { fill: #f8fafc; }
.deskbook-map .workplace .asset-outline { stroke: #2563eb; stroke-width: 1.5; fill: none; vector-effect: non-scaling-stroke; }
.deskbook-map .asset .asset-outline { stroke: #64748b; stroke-width: 1.25; fill: none; vector-effect: non-scaling-stroke; }
.deskbook-map .workplace:hover .asset-outline,
.deskbook-map .workplace:focus .asset-outline { stroke: #0f172a; stroke-width: 2.5; }
.deskbook-map .workplace-label { fill: #1d4ed8; font-family: sans-serif; font-weight: 600; pointer-events: none; text-anchor: middle; dominant-baseline: middle; }
`)
	w.end("style")
	for _, id := range builtinOrder {
		appendBuiltinSymbol(w, id)
	}
	seen := map[string]bool{}
	for id := range builtinComponents {
		seen[id] = true
	}
	for _, component := range components {
		id := safeComponentID(component.ID)
		if id == "" || seen[id] {
			continue
		}
		markup, err := sanitizeSVGFragment(component.SVGMarkup)
		if err != nil {
			return fmt.Errorf("custom component %s: %w", id, err)
		}
		vx, vy, vw, vh := componentViewBox(component)
		w.start("symbol", a("id", id), a("viewBox", numList(vx, vy, vw, vh)))
		w.rawIndented(markup)
		w.end("symbol")
		seen[id] = true
	}
	w.end("defs")
	return nil
}

func appendBuiltinSymbol(w *xmlWriter, id string) {
	fillAttrs := []attr{a("fill", "#dbeafe")}
	outlineAttrs := []attr{a("stroke", "#2563eb"), a("stroke-width", "1.5"), a("fill", "none"), a("vector-effect", "non-scaling-stroke")}
	attrs := func(base ...attr) []attr {
		return append([]attr{}, base...)
	}
	switch id {
	case "desk-short":
		w.start("symbol", a("id", "desk-short"), a("viewBox", "0 0 100 60"))
		w.empty("rect", append(attrs(a("class", "asset-fill"), a("x", "2"), a("y", "2"), a("width", "96"), a("height", "56"), a("rx", "8")), fillAttrs...)...)
		w.empty("rect", append(attrs(a("class", "asset-outline"), a("x", "2"), a("y", "2"), a("width", "96"), a("height", "56"), a("rx", "8")), outlineAttrs...)...)
		w.end("symbol")
	case "desk-long":
		w.start("symbol", a("id", "desk-long"), a("viewBox", "0 0 160 60"))
		w.empty("rect", append(attrs(a("class", "asset-fill"), a("x", "2"), a("y", "2"), a("width", "156"), a("height", "56"), a("rx", "8")), fillAttrs...)...)
		w.empty("path", append(attrs(a("class", "asset-outline"), a("d", "M80 8v44")), outlineAttrs...)...)
		w.empty("rect", append(attrs(a("class", "asset-outline"), a("x", "2"), a("y", "2"), a("width", "156"), a("height", "56"), a("rx", "8")), outlineAttrs...)...)
		w.end("symbol")
	case "chair", "conference-chair":
		w.start("symbol", a("id", id), a("viewBox", "0 0 64 64"))
		w.empty("rect", append(attrs(a("class", "asset-fill"), a("x", "12"), a("y", "18"), a("width", "40"), a("height", "34"), a("rx", "10")), fillAttrs...)...)
		w.empty("path", append(attrs(a("class", "asset-outline"), a("d", "M18 18V8h28v10M14 52h36")), outlineAttrs...)...)
		w.empty("rect", append(attrs(a("class", "asset-outline"), a("x", "12"), a("y", "18"), a("width", "40"), a("height", "34"), a("rx", "10")), outlineAttrs...)...)
		w.end("symbol")
	case "meeting-table":
		w.start("symbol", a("id", "meeting-table"), a("viewBox", "0 0 140 90"))
		w.empty("rect", append(attrs(a("class", "asset-fill"), a("x", "18"), a("y", "16"), a("width", "104"), a("height", "58"), a("rx", "22")), fillAttrs...)...)
		w.empty("rect", append(attrs(a("class", "asset-outline"), a("x", "18"), a("y", "16"), a("width", "104"), a("height", "58"), a("rx", "22")), outlineAttrs...)...)
		for _, p := range [][2]string{{"22", "10"}, {"70", "8"}, {"118", "10"}, {"22", "80"}, {"70", "82"}, {"118", "80"}} {
			w.empty("circle", append(attrs(a("class", "asset-outline"), a("cx", p[0]), a("cy", p[1]), a("r", "5")), outlineAttrs...)...)
		}
		w.end("symbol")
	case "workplace-desk-chair":
		w.start("symbol", a("id", "workplace-desk-chair"), a("viewBox", "0 0 140 125"))
		w.empty("use", a("href", "#desk-short"), a("x", "0"), a("y", "0"), a("width", "140"), a("height", "70"))
		w.start("g", a("class", "chair"), a("data-role", "chair"))
		w.empty("use", a("href", "#chair"), a("x", "45"), a("y", "75"), a("width", "50"), a("height", "50"))
		w.end("g")
		w.end("symbol")
	case "conference-set":
		w.start("symbol", a("id", "conference-set"), a("viewBox", "0 0 220 150"))
		w.empty("use", a("href", "#meeting-table"), a("x", "40"), a("y", "30"), a("width", "140"), a("height", "90"))
		for _, p := range [][3]string{{"85", "0", "0"}, {"85", "118", "180"}, {"0", "48", "-90"}, {"156", "48", "90"}} {
			w.start("g", a("transform", "translate("+p[0]+" "+p[1]+") rotate("+p[2]+" 32 32)"))
			w.empty("use", a("href", "#conference-chair"), a("width", "64"), a("height", "64"))
			w.end("g")
		}
		w.end("symbol")
	}
}

func appendBackground(w *xmlWriter, doc LayoutDocument, vx, vy, vw, vh float64) {
	w.start("g", a("class", "background"), a("data-layer", "background"))
	w.empty("rect", a("x", num(vx)), a("y", num(vy)), a("width", num(vw)), a("height", num(vh)), a("fill", "#f3f6fb"))
	if href := safeHref(doc.BgURL); href != "" {
		x, y, bw, bh := vx, vy, vw, vh
		if doc.BgTransform != nil && doc.BgTransform.W > 0 && doc.BgTransform.H > 0 {
			x, y, bw, bh = doc.BgTransform.X, doc.BgTransform.Y, doc.BgTransform.W, doc.BgTransform.H
		}
		w.empty("image",
			a("class", "background-plan"),
			a("href", href),
			a("x", num(x)),
			a("y", num(y)),
			a("width", num(math.Max(1, bw))),
			a("height", num(math.Max(1, bh))),
			a("preserveAspectRatio", "xMidYMid meet"),
			a("pointer-events", "none"),
		)
	}
	w.end("g")
}

func appendStructure(w *xmlWriter, doc LayoutDocument) {
	w.start("g", a("class", "structure"), a("data-layer", "structure"))
	appendStructureGroup(w, "boundaries", "zone-boundary", doc.Boundaries, "#1d4ed8", true)
	appendStructureGroup(w, "walls", "wall", doc.Walls, "#2f343b", false)
	appendStructureGroup(w, "partitions", "partition", doc.Partitions, "#4b5563", false)
	appendStructureGroup(w, "doors", "door", doc.Doors, "#1f2937", false)
	w.end("g")
}

func appendStructureGroup(w *xmlWriter, layerName, className string, items []StructureElement, fallbackStroke string, allowFill bool) {
	w.start("g", a("class", layerName), a("data-layer", layerName))
	for _, item := range items {
		pts := points(item.PTS)
		if pts == "" {
			continue
		}
		tag := "polyline"
		if item.Closed {
			tag = "polygon"
		}
		stroke := safeColor(item.Color, fallbackStroke)
		fill := "none"
		fillOpacity := "0"
		if allowFill && item.Closed {
			fill = stroke
			fillOpacity = "0.10"
		}
		attrs := []attr{
			a("class", className),
			a("id", safeID(item.ID, className+"-item")),
			a("points", pts),
			a("fill", fill),
			a("fill-opacity", fillOpacity),
			a("stroke", stroke),
			a("stroke-width", num(math.Max(0.1, finite(item.Thick, 1)))),
			a("stroke-linecap", "butt"),
			a("stroke-linejoin", "round"),
		}
		if item.Label != "" {
			attrs = append(attrs, a("data-label", item.Label))
		}
		w.empty(tag, attrs...)
	}
	w.end("g")
}

func appendLayoutObject(w *xmlWriter, desk LayoutDesk, buildingID, storeyID, zoneID string, componentLookup map[string]componentMeta) {
	x := finite(desk.X, 0)
	y := finite(desk.Y, 0)
	width := math.Max(1, finite(desk.W, 1))
	height := math.Max(1, finite(desk.H, 1))
	componentID := safeComponentID(firstNonEmpty(desk.ComponentID, desk.SymbolID))
	if componentID == "" {
		componentID = "desk-short"
	}
	meta, ok := componentLookup[componentID]
	if !ok {
		componentID = "desk-short"
		meta = componentLookup[componentID]
	}
	assetType := safeAssetType(firstNonEmpty(desk.AssetType, meta.AssetType))
	isWorkplace := assetType == "workplace"
	objectID := safeID(desk.ID, assetType+"-asset")
	workplaceID := ""
	if isWorkplace {
		workplaceID = safeID(firstNonEmpty(desk.WorkplaceID, desk.ID), "workplace")
		objectID = workplaceID
	}
	className := "asset asset-" + safeClassFragment(assetType)
	if isWorkplace {
		className = "workplace"
	}

	transform := fmt.Sprintf("translate(%s %s)", num(x), num(y))
	if math.Abs(desk.R) > 1e-6 {
		transform += fmt.Sprintf(" rotate(%s %s %s)", num(desk.R), num(width/2), num(height/2))
	}
	attrs := []attr{
		a("class", className),
		a("id", objectID),
		a("transform", transform),
		a("data-desk-id", safeData(desk.ID, objectID)),
		a("data-label", desk.Label),
		a("data-inventory-number", desk.InventoryNumber),
		a("data-building", safeData(firstNonEmpty(desk.BuildingID, buildingID), buildingID)),
		a("data-storey", safeData(firstNonEmpty(desk.StoreyID, storeyID), storeyID)),
		a("data-zone", safeData(firstNonEmpty(desk.ZoneID, zoneID), zoneID)),
		a("data-symbol", componentID),
		a("data-component-id", componentID),
		a("data-asset-type", assetType),
	}
	if isWorkplace {
		attrs = append(attrs, a("data-workplace-id", workplaceID), a("tabindex", "0"))
	}
	w.start("g", attrs...)
	vx, vy, vw, vh := meta.ViewBox[0], meta.ViewBox[1], meta.ViewBox[2], meta.ViewBox[3]
	if vw <= 0 || vh <= 0 {
		vx, vy, vw, vh = 0, 0, width, height
	}
	w.start("g",
		a("class", "component-instance"),
		a("transform", fmt.Sprintf("scale(%s %s) translate(%s %s)", num(width/vw), num(height/vh), num(-vx), num(-vy))),
	)
	w.empty("use", a("href", "#"+componentID), a("width", num(vw)), a("height", num(vh)))
	w.end("g")
	if isWorkplace {
		w.start("text",
			a("class", "workplace-label"),
			a("x", num(width/2)),
			a("y", num(height/2)),
			a("font-size", num(math.Max(8, math.Min(height*0.42, width*0.2)))),
		)
		w.text(desk.Label)
		w.end("text")
	}
	w.end("g")
}

func buildComponentLookup(components []LayoutComponent) map[string]componentMeta {
	lookup := make(map[string]componentMeta, len(builtinComponents)+len(components))
	for id, meta := range builtinComponents {
		lookup[id] = meta
	}
	for _, component := range components {
		id := safeComponentID(component.ID)
		if id == "" {
			continue
		}
		if _, builtin := builtinComponents[id]; builtin {
			continue
		}
		vx, vy, vw, vh := componentViewBox(component)
		lookup[id] = componentMeta{
			AssetType: safeAssetType(component.AssetType),
			ViewBox:   [4]float64{vx, vy, vw, vh},
			DefaultW:  math.Max(1, finite(component.DefaultW, vw)),
			DefaultH:  math.Max(1, finite(component.DefaultH, vh)),
			Source:    "custom",
		}
	}
	return lookup
}

func componentViewBox(component LayoutComponent) (float64, float64, float64, float64) {
	if len(component.ViewBox) >= 4 && component.ViewBox[2] > 0 && component.ViewBox[3] > 0 {
		return component.ViewBox[0], component.ViewBox[1], component.ViewBox[2], component.ViewBox[3]
	}
	return 0, 0, 100, 60
}

func sanitizeSVGFragment(markup string) (string, error) {
	if strings.TrimSpace(markup) == "" {
		return "", fmt.Errorf("empty SVG markup")
	}
	decoder := xml.NewDecoder(strings.NewReader("<svg>" + markup + "</svg>"))
	var b strings.Builder
	depth := -1
	for {
		token, err := decoder.Token()
		if err == io.EOF {
			break
		}
		if err != nil {
			return "", err
		}
		switch t := token.(type) {
		case xml.StartElement:
			tag := localName(t.Name)
			depth++
			if depth == 0 && tag == "svg" {
				continue
			}
			if !allowedCustomTags[tag] {
				return "", fmt.Errorf("disallowed SVG element %q", tag)
			}
			b.WriteString(strings.Repeat("  ", depth-1))
			b.WriteString("<" + tag)
			for _, xmlAttr := range t.Attr {
				name, value, ok, err := sanitizeCustomAttr(xmlAttr)
				if err != nil {
					return "", err
				}
				if ok {
					b.WriteString(" " + name + `="` + escapeAttr(value) + `"`)
				}
			}
			b.WriteString(">\n")
		case xml.EndElement:
			tag := localName(t.Name)
			if depth == 0 && tag == "svg" {
				depth--
				continue
			}
			if depth > 0 {
				b.WriteString(strings.Repeat("  ", depth-1))
				b.WriteString("</" + tag + ">\n")
			}
			depth--
		case xml.CharData:
			text := strings.TrimSpace(string(t))
			if text != "" && depth > 0 {
				if len(text) > 300 {
					text = text[:300]
				}
				b.WriteString(strings.Repeat("  ", depth))
				b.WriteString(html.EscapeString(text))
				b.WriteString("\n")
			}
		case xml.ProcInst, xml.Directive:
			return "", fmt.Errorf("disallowed XML instruction")
		}
	}
	return strings.TrimRight(b.String(), "\n"), nil
}

func sanitizeCustomAttr(xmlAttr xml.Attr) (string, string, bool, error) {
	name := localName(xmlAttr.Name)
	value := strings.TrimSpace(xmlAttr.Value)
	lower := strings.ToLower(value)
	if strings.HasPrefix(strings.ToLower(name), "on") || strings.Contains(lower, "javascript:") {
		return "", "", false, fmt.Errorf("unsafe SVG attribute")
	}
	if !allowedCustomAttrs[name] {
		return "", "", false, nil
	}
	if strings.Contains(lower, "url(") || strings.ContainsAny(value, "\r\n\t") {
		return "", "", false, nil
	}
	switch name {
	case "id":
		return name, safeID(value, "component-node"), true, nil
	case "class":
		return name, safeClassList(value), true, nil
	case "href", "xlink:href":
		if localHrefRE.MatchString(value) {
			return "href", value, true, nil
		}
		return "", "", false, nil
	default:
		if len(value) > 2000 {
			value = value[:2000]
		}
		return name, value, true, nil
	}
}

func viewBox(vb []float64) (float64, float64, float64, float64) {
	if len(vb) >= 4 && vb[2] > 0 && vb[3] > 0 {
		return vb[0], vb[1], vb[2], vb[3]
	}
	return 0, 0, 1000, 1000
}

func points(pts [][]float64) string {
	out := make([]string, 0, len(pts))
	for _, pt := range pts {
		if len(pt) < 2 {
			continue
		}
		out = append(out, num(pt[0])+","+num(pt[1]))
	}
	return strings.Join(out, " ")
}

func safeComponentID(value string) string {
	value = strings.TrimSpace(value)
	if safeComponentIDRE.MatchString(value) {
		return value
	}
	return ""
}

func safeID(value string, fallback string) string {
	raw := strings.TrimSpace(value)
	if raw == "" {
		raw = fallback
	}
	safe := safeToken(raw)
	if safe == "" {
		safe = fallback
	}
	if safe != "" && !regexp.MustCompile(`^[A-Za-z_]`).MatchString(safe) {
		safe = "id-" + safe
	}
	if len(safe) > 120 {
		return safe[:120]
	}
	return safe
}

func safeData(value string, fallback string) string {
	safe := safeToken(value)
	if safe == "" {
		return fallback
	}
	if len(safe) > 120 {
		return safe[:120]
	}
	return safe
}

func safeToken(value string) string {
	value = strings.TrimSpace(value)
	var b strings.Builder
	lastDash := false
	for _, r := range value {
		ok := (r >= 'A' && r <= 'Z') || (r >= 'a' && r <= 'z') || (r >= '0' && r <= '9') || r == '_' || r == '.' || r == ':' || r == '-'
		if ok {
			b.WriteRune(r)
			lastDash = false
		} else if !lastDash {
			b.WriteRune('-')
			lastDash = true
		}
	}
	return strings.Trim(b.String(), "-")
}

func safeClassFragment(value string) string {
	value = strings.ReplaceAll(strings.TrimSpace(value), "_", "-")
	safe := safeToken(value)
	if safe == "" {
		return "asset"
	}
	return safe
}

func safeClassList(value string) string {
	parts := strings.Fields(value)
	out := make([]string, 0, len(parts))
	for _, part := range parts {
		if safe := safeClassFragment(part); safe != "" {
			out = append(out, safe)
		}
		if len(out) == 10 {
			break
		}
	}
	return strings.Join(out, " ")
}

func safeAssetType(value string) string {
	switch strings.TrimSpace(value) {
	case "workplace", "desk", "chair", "meeting_table", "conference_set", "asset":
		return strings.TrimSpace(value)
	default:
		return "asset"
	}
}

func safeColor(value string, fallback string) string {
	value = strings.TrimSpace(value)
	if hexColorRE.MatchString(value) {
		return value
	}
	return fallback
}

func safeHref(value string) string {
	value = strings.TrimSpace(value)
	if value == "" || strings.ContainsAny(value, "\r\n\t") {
		return ""
	}
	if strings.HasPrefix(value, "http://") || strings.HasPrefix(value, "https://") || strings.HasPrefix(value, "/") || strings.HasPrefix(value, "./") || strings.HasPrefix(value, "../") {
		return value
	}
	if strings.HasPrefix(strings.ToLower(value), "data:image/") && dataImageRE.MatchString(value) {
		return value
	}
	if strings.Contains(value, ":") {
		return ""
	}
	return value
}

func localName(name xml.Name) string {
	if name.Local != "" {
		return name.Local
	}
	raw := name.Space
	if raw == "" {
		raw = name.Local
	}
	if idx := strings.LastIndex(raw, ":"); idx >= 0 {
		return raw[idx+1:]
	}
	return raw
}

func firstNonEmpty(values ...string) string {
	for _, value := range values {
		if strings.TrimSpace(value) != "" {
			return value
		}
	}
	return ""
}

func finite(value float64, fallback float64) float64 {
	if math.IsNaN(value) || math.IsInf(value, 0) {
		return fallback
	}
	return value
}

func num(value float64) string {
	if math.Abs(value-math.Round(value)) < 1e-9 {
		return strconv.FormatInt(int64(math.Round(value)), 10)
	}
	return strconv.FormatFloat(value, 'f', -1, 64)
}

func numList(values ...float64) string {
	out := make([]string, 0, len(values))
	for _, value := range values {
		out = append(out, num(value))
	}
	return strings.Join(out, " ")
}

func a(name string, value string) attr {
	return attr{name: name, value: value}
}

func escapeAttr(value string) string {
	var b bytes.Buffer
	xml.EscapeText(&b, []byte(value))
	return strings.NewReplacer(`"`, "&quot;", "'", "&apos;").Replace(b.String())
}

func indentBlock(value string, indent string) string {
	lines := strings.Split(strings.TrimRight(value, "\n"), "\n")
	for i, line := range lines {
		if strings.TrimSpace(line) != "" {
			lines[i] = indent + line
		}
	}
	return strings.Join(lines, "\n")
}

type xmlWriter struct {
	b     *strings.Builder
	level int
}

func (w *xmlWriter) start(name string, attrs ...attr) {
	w.indent()
	w.b.WriteString("<" + name)
	for _, attr := range attrs {
		w.b.WriteString(" " + attr.name + `="` + escapeAttr(attr.value) + `"`)
	}
	w.b.WriteString(">\n")
	w.level++
}

func (w *xmlWriter) empty(name string, attrs ...attr) {
	w.indent()
	w.b.WriteString("<" + name)
	for _, attr := range attrs {
		w.b.WriteString(" " + attr.name + `="` + escapeAttr(attr.value) + `"`)
	}
	w.b.WriteString("/>\n")
}

func (w *xmlWriter) end(name string) {
	w.level--
	w.indent()
	w.b.WriteString("</" + name + ">\n")
}

func (w *xmlWriter) text(value string) {
	if strings.TrimSpace(value) == "" {
		return
	}
	w.indent()
	w.b.WriteString(html.EscapeString(value))
	w.b.WriteString("\n")
}

func (w *xmlWriter) rawIndented(value string) {
	for _, line := range strings.Split(strings.TrimRight(value, "\n"), "\n") {
		w.indent()
		w.b.WriteString(line)
		w.b.WriteByte('\n')
	}
}

func (w *xmlWriter) indent() {
	w.b.WriteString(strings.Repeat("  ", w.level))
}
