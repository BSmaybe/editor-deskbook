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
	"sit-stand-desk":       {AssetType: "desk", ViewBox: [4]float64{0, 0, 120, 70}, DefaultW: 120, DefaultH: 70, Source: "system"},
	"bench-4":              {AssetType: "desk", ViewBox: [4]float64{0, 0, 220, 120}, DefaultW: 220, DefaultH: 120, Source: "system"},
	"meeting-table":        {AssetType: "meeting_table", ViewBox: [4]float64{0, 0, 140, 90}, DefaultW: 140, DefaultH: 90, Source: "system"},
	"round-table":          {AssetType: "meeting_table", ViewBox: [4]float64{0, 0, 110, 110}, DefaultW: 110, DefaultH: 110, Source: "system"},
	"conference-chair":     {AssetType: "chair", ViewBox: [4]float64{0, 0, 64, 64}, DefaultW: 64, DefaultH: 64, Source: "system"},
	"conference-set":       {AssetType: "conference_set", ViewBox: [4]float64{0, 0, 220, 150}, DefaultW: 220, DefaultH: 150, Source: "system"},
	"phone-booth":          {AssetType: "call_room", ViewBox: [4]float64{0, 0, 95, 120}, DefaultW: 95, DefaultH: 120, Source: "system"},
	"focus-room":           {AssetType: "call_room", ViewBox: [4]float64{0, 0, 150, 115}, DefaultW: 150, DefaultH: 115, Source: "system"},
	"sofa":                 {AssetType: "sofa", ViewBox: [4]float64{0, 0, 150, 72}, DefaultW: 150, DefaultH: 72, Source: "system"},
	"lounge-chair":         {AssetType: "chair", ViewBox: [4]float64{0, 0, 82, 82}, DefaultW: 82, DefaultH: 82, Source: "system"},
	"plant":                {AssetType: "plant", ViewBox: [4]float64{0, 0, 70, 90}, DefaultW: 70, DefaultH: 90, Source: "system"},
	"storage-cabinet":      {AssetType: "storage", ViewBox: [4]float64{0, 0, 95, 80}, DefaultW: 95, DefaultH: 80, Source: "system"},
	"locker-bank":          {AssetType: "storage", ViewBox: [4]float64{0, 0, 150, 82}, DefaultW: 150, DefaultH: 82, Source: "system"},
	"printer":              {AssetType: "printer", ViewBox: [4]float64{0, 0, 90, 75}, DefaultW: 90, DefaultH: 75, Source: "system"},
	"reception-desk":       {AssetType: "reception", ViewBox: [4]float64{0, 0, 180, 90}, DefaultW: 180, DefaultH: 90, Source: "system"},
	"column":               {AssetType: "column", ViewBox: [4]float64{0, 0, 64, 64}, DefaultW: 64, DefaultH: 64, Source: "system"},
}

var builtinOrder = []string{
	"workplace-desk-chair",
	"desk-short",
	"desk-long",
	"sit-stand-desk",
	"bench-4",
	"chair",
	"meeting-table",
	"round-table",
	"conference-chair",
	"conference-set",
	"phone-booth",
	"focus-room",
	"sofa",
	"lounge-chair",
	"plant",
	"storage-cabinet",
	"locker-bank",
	"printer",
	"reception-desk",
	"column",
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
	appendZones(&w, doc)
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
	case "sit-stand-desk":
		w.start("symbol", a("id", "sit-stand-desk"), a("viewBox", "0 0 120 70"))
		w.empty("rect", append(attrs(a("class", "asset-fill"), a("x", "6"), a("y", "8"), a("width", "108"), a("height", "48"), a("rx", "8")), fillAttrs...)...)
		w.empty("rect", append(attrs(a("class", "asset-outline"), a("x", "6"), a("y", "8"), a("width", "108"), a("height", "48"), a("rx", "8")), outlineAttrs...)...)
		w.empty("path", append(attrs(a("class", "asset-outline"), a("d", "M26 56v10M94 56v10M38 20h44"), a("stroke-linecap", "round")), outlineAttrs...)...)
		w.end("symbol")
	case "bench-4":
		w.start("symbol", a("id", "bench-4"), a("viewBox", "0 0 220 120"))
		w.empty("rect", append(attrs(a("class", "asset-fill"), a("x", "10"), a("y", "14"), a("width", "200"), a("height", "92"), a("rx", "10")), fillAttrs...)...)
		w.empty("path", append(attrs(a("class", "asset-outline"), a("d", "M110 14v92M10 60h200")), outlineAttrs...)...)
		w.empty("rect", append(attrs(a("class", "asset-outline"), a("x", "10"), a("y", "14"), a("width", "200"), a("height", "92"), a("rx", "10")), outlineAttrs...)...)
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
	case "round-table":
		w.start("symbol", a("id", "round-table"), a("viewBox", "0 0 110 110"))
		w.empty("circle", append(attrs(a("class", "asset-fill"), a("cx", "55"), a("cy", "55"), a("r", "34")), fillAttrs...)...)
		w.empty("circle", append(attrs(a("class", "asset-outline"), a("cx", "55"), a("cy", "55"), a("r", "34")), outlineAttrs...)...)
		for _, p := range [][2]string{{"55", "12"}, {"55", "98"}, {"12", "55"}, {"98", "55"}} {
			w.empty("circle", append(attrs(a("class", "asset-outline"), a("cx", p[0]), a("cy", p[1]), a("r", "6")), outlineAttrs...)...)
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
	case "phone-booth":
		w.start("symbol", a("id", "phone-booth"), a("viewBox", "0 0 95 120"))
		w.empty("rect", a("class", "asset-fill"), a("x", "8"), a("y", "6"), a("width", "79"), a("height", "108"), a("rx", "12"), a("fill", "#ecfeff"))
		w.empty("rect", a("class", "asset-outline"), a("x", "8"), a("y", "6"), a("width", "79"), a("height", "108"), a("rx", "12"), a("fill", "none"), a("stroke", "#0891b2"), a("stroke-width", "1.8"))
		w.empty("path", a("d", "M28 34h39M28 52h39M64 92h8"), a("fill", "none"), a("stroke", "#0891b2"), a("stroke-width", "1.5"), a("stroke-linecap", "round"))
		w.end("symbol")
	case "focus-room":
		w.start("symbol", a("id", "focus-room"), a("viewBox", "0 0 150 115"))
		w.empty("rect", a("class", "asset-fill"), a("x", "8"), a("y", "8"), a("width", "134"), a("height", "99"), a("rx", "10"), a("fill", "#ecfeff"))
		w.empty("rect", a("class", "asset-outline"), a("x", "8"), a("y", "8"), a("width", "134"), a("height", "99"), a("rx", "10"), a("fill", "none"), a("stroke", "#0891b2"), a("stroke-width", "1.8"))
		w.empty("rect", a("x", "38"), a("y", "36"), a("width", "74"), a("height", "38"), a("rx", "8"), a("fill", "none"), a("stroke", "#0891b2"), a("stroke-width", "1.5"))
		w.empty("path", a("d", "M112 58h18"), a("fill", "none"), a("stroke", "#0891b2"), a("stroke-width", "1.5"), a("stroke-linecap", "round"))
		w.end("symbol")
	case "sofa":
		w.start("symbol", a("id", "sofa"), a("viewBox", "0 0 150 72"))
		w.empty("rect", a("class", "asset-fill"), a("x", "14"), a("y", "24"), a("width", "122"), a("height", "34"), a("rx", "12"), a("fill", "#fce7f3"))
		w.empty("path", a("class", "asset-outline"), a("d", "M22 24V12h106v12M14 44H4v18h142V44h-10M52 24v34M98 24v34"), a("fill", "none"), a("stroke", "#be185d"), a("stroke-width", "1.5"), a("stroke-linejoin", "round"))
		w.empty("rect", a("class", "asset-outline"), a("x", "14"), a("y", "24"), a("width", "122"), a("height", "34"), a("rx", "12"), a("fill", "none"), a("stroke", "#be185d"), a("stroke-width", "1.5"))
		w.end("symbol")
	case "lounge-chair":
		w.start("symbol", a("id", "lounge-chair"), a("viewBox", "0 0 82 82"))
		w.empty("circle", a("class", "asset-fill"), a("cx", "41"), a("cy", "42"), a("r", "28"), a("fill", "#fce7f3"))
		w.empty("path", a("class", "asset-outline"), a("d", "M18 42c0-14 10-24 23-24s23 10 23 24v18H18V42zM24 62l-6 12M58 62l6 12"), a("fill", "none"), a("stroke", "#be185d"), a("stroke-width", "1.5"), a("stroke-linecap", "round"), a("stroke-linejoin", "round"))
		w.end("symbol")
	case "plant":
		w.start("symbol", a("id", "plant"), a("viewBox", "0 0 70 90"))
		w.empty("path", a("d", "M18 36c-8-18 6-28 17-8C42 8 60 13 48 36c18-8 22 12 4 20H18C0 48 3 28 18 36z"), a("fill", "#dcfce7"), a("stroke", "#16a34a"), a("stroke-width", "1.5"), a("stroke-linejoin", "round"))
		w.empty("path", a("d", "M35 32v30"), a("fill", "none"), a("stroke", "#16a34a"), a("stroke-width", "1.5"))
		w.empty("rect", a("x", "20"), a("y", "60"), a("width", "30"), a("height", "22"), a("rx", "5"), a("fill", "#fef3c7"), a("stroke", "#a16207"), a("stroke-width", "1.5"))
		w.end("symbol")
	case "storage-cabinet":
		w.start("symbol", a("id", "storage-cabinet"), a("viewBox", "0 0 95 80"))
		w.empty("rect", a("class", "asset-fill"), a("x", "8"), a("y", "8"), a("width", "79"), a("height", "64"), a("rx", "6"), a("fill", "#f1f5f9"))
		w.empty("rect", a("class", "asset-outline"), a("x", "8"), a("y", "8"), a("width", "79"), a("height", "64"), a("rx", "6"), a("fill", "none"), a("stroke", "#64748b"), a("stroke-width", "1.5"))
		w.empty("path", a("d", "M47.5 8v64M18 24h20M57 24h20M18 44h20M57 44h20"), a("fill", "none"), a("stroke", "#64748b"), a("stroke-width", "1.5"), a("stroke-linecap", "round"))
		w.end("symbol")
	case "locker-bank":
		w.start("symbol", a("id", "locker-bank"), a("viewBox", "0 0 150 82"))
		w.empty("rect", a("class", "asset-fill"), a("x", "8"), a("y", "8"), a("width", "134"), a("height", "66"), a("rx", "6"), a("fill", "#f1f5f9"))
		w.empty("rect", a("class", "asset-outline"), a("x", "8"), a("y", "8"), a("width", "134"), a("height", "66"), a("rx", "6"), a("fill", "none"), a("stroke", "#64748b"), a("stroke-width", "1.5"))
		w.empty("path", a("d", "M41 8v66M74 8v66M107 8v66M22 22h8M55 22h8M88 22h8M121 22h8"), a("fill", "none"), a("stroke", "#64748b"), a("stroke-width", "1.5"), a("stroke-linecap", "round"))
		w.end("symbol")
	case "printer":
		w.start("symbol", a("id", "printer"), a("viewBox", "0 0 90 75"))
		w.empty("rect", a("class", "asset-fill"), a("x", "14"), a("y", "28"), a("width", "62"), a("height", "30"), a("rx", "6"), a("fill", "#f1f5f9"))
		w.empty("path", a("class", "asset-outline"), a("d", "M24 28V10h42v18M24 52v14h42V52M20 40h8"), a("fill", "none"), a("stroke", "#64748b"), a("stroke-width", "1.5"), a("stroke-linecap", "round"), a("stroke-linejoin", "round"))
		w.empty("rect", a("class", "asset-outline"), a("x", "14"), a("y", "28"), a("width", "62"), a("height", "30"), a("rx", "6"), a("fill", "none"), a("stroke", "#64748b"), a("stroke-width", "1.5"))
		w.end("symbol")
	case "reception-desk":
		w.start("symbol", a("id", "reception-desk"), a("viewBox", "0 0 180 90"))
		w.empty("path", a("class", "asset-fill"), a("d", "M14 66c12-34 40-52 76-52s64 18 76 52v10H14V66z"), a("fill", "#fef3c7"))
		w.empty("path", a("class", "asset-outline"), a("d", "M14 66c12-34 40-52 76-52s64 18 76 52v10H14V66zM52 54h76"), a("fill", "none"), a("stroke", "#a16207"), a("stroke-width", "1.7"), a("stroke-linecap", "round"), a("stroke-linejoin", "round"))
		w.end("symbol")
	case "column":
		w.start("symbol", a("id", "column"), a("viewBox", "0 0 64 64"))
		w.empty("rect", a("x", "8"), a("y", "8"), a("width", "48"), a("height", "48"), a("rx", "6"), a("fill", "#e2e8f0"), a("stroke", "#475569"), a("stroke-width", "1.8"))
		w.empty("path", a("d", "M16 48L48 16M18 18l28 28"), a("fill", "none"), a("stroke", "#64748b"), a("stroke-width", "1.2"), a("stroke-linecap", "round"))
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

func appendZones(w *xmlWriter, doc LayoutDocument) {
	if len(doc.Zones) == 0 {
		return
	}
	w.start("g", a("class", "map-zones"), a("data-layer", "zones"))
	for _, zone := range doc.Zones {
		if len(zone.PTS) < 3 {
			continue
		}
		color := zone.Color
		if color == "" {
			color = zoneDefaultColor(zone.Type)
		}
		var pts strings.Builder
		for i, pt := range zone.PTS {
			if len(pt) < 2 {
				continue
			}
			if i > 0 {
				pts.WriteByte(' ')
			}
			pts.WriteString(num(pt[0]) + "," + num(pt[1]))
		}
		attrs := []attr{
			a("class", "map-zone"),
			a("data-zone-type", zone.Type),
			a("data-zone-id", zone.ID),
			a("points", pts.String()),
			a("fill", color),
			a("fill-opacity", "0.18"),
			a("stroke", color),
			a("stroke-width", "1.5"),
			a("stroke-opacity", "0.6"),
		}
		w.empty("polygon", attrs...)
		if zone.Label != "" {
			// centroid label
			var cx, cy float64
			for _, pt := range zone.PTS {
				if len(pt) >= 2 {
					cx += pt[0]
					cy += pt[1]
				}
			}
			n := float64(len(zone.PTS))
			w.start("text",
				a("x", num(cx/n)),
				a("y", num(cy/n)),
				a("text-anchor", "middle"),
				a("dominant-baseline", "middle"),
				a("font-size", "12"),
				a("fill", color),
				a("font-weight", "600"),
				a("pointer-events", "none"),
				a("class", "map-zone-label"),
			)
			w.text(zone.Label)
			w.end("text")
		}
	}
	w.end("g")
}

func zoneDefaultColor(zoneType string) string {
	switch zoneType {
	case "kitchen":
		return "#fef9c3"
	case "reception":
		return "#fce7f3"
	case "chill":
		return "#dcfce7"
	case "focus":
		return "#ede9fe"
	case "meeting":
		return "#dbeafe"
	case "open_space":
		return "#fff7ed"
	default:
		return "#f1f5f9"
	}
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
	case "workplace", "desk", "chair", "meeting_table", "conference_set", "call_room",
		"lounge", "sofa", "plant", "storage", "printer", "reception", "column", "asset":
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
