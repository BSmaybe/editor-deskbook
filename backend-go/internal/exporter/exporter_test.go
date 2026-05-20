package exporter

import (
	"encoding/json"
	"strings"
	"testing"
)

func TestRenderSVGSemanticStructure(t *testing.T) {
	layout := LayoutDocument{
		ViewBox:    []float64{0, 0, 700, 500},
		BuildingID: "alfarabi",
		StoreyID:   "2",
		ZoneID:     "a9",
		BgURL:      "/static/floor.svg",
		Components: []LayoutComponent{{
			ID:        "custom-desk",
			Label:     "Custom desk",
			AssetType: "workplace",
			Source:    "custom",
			ViewBox:   []float64{0, 0, 33, 22},
			DefaultW:  33,
			DefaultH:  22,
			SVGMarkup: `<rect x="0" y="0" width="33" height="22" rx="2" fill="#dbeafe" stroke="#2563eb" stroke-width="1.5"/>`,
		}},
		Boundaries: []StructureElement{{
			ID: "zone-a9", PTS: [][]float64{{0, 0}, {100, 0}, {100, 60}}, Thick: 1.5, Color: "#1d4ed8", Closed: true,
		}},
		Desks: []LayoutDesk{{
			ID: "desk-1", Label: "D-1", WorkplaceID: "bcchub-wp3452", ComponentID: "custom-desk",
			AssetType: "workplace", BuildingID: "alfarabi", StoreyID: "2", ZoneID: "a9",
			X: 100, Y: 200, W: 33, H: 22, R: 15,
		}},
	}

	svg, err := RenderSVG(layout)
	if err != nil {
		t.Fatalf("RenderSVG failed: %v", err)
	}
	assertContains(t, svg, `<defs>`)
	assertContains(t, svg, `<symbol id="custom-desk" viewBox="0 0 33 22">`)
	assertContains(t, svg, `<g class="background" data-layer="background">`)
	assertContains(t, svg, `<g class="structure" data-layer="structure">`)
	assertContains(t, svg, `<g class="building" id="alfarabi" data-building="alfarabi">`)
	assertContains(t, svg, `<g class="storey" id="alfarabi-2" data-building="alfarabi" data-storey="2">`)
	assertContains(t, svg, `<g class="zone" id="alfarabi-2-a9" data-building="alfarabi" data-storey="2" data-zone="a9">`)
	assertContains(t, svg, `<g class="workplace" id="bcchub-wp3452" transform="translate(100 200) rotate(15 16.5 11)" data-desk-id="desk-1"`)
	assertContains(t, svg, `data-workplace-id="bcchub-wp3452"`)
	assertContains(t, svg, `data-building="alfarabi"`)
	assertContains(t, svg, `data-storey="2"`)
	assertContains(t, svg, `data-zone="a9"`)
	assertContains(t, svg, `<g class="component-instance" transform="scale(1 1) translate(0 0)">`)
	assertContains(t, svg, `<use href="#custom-desk" width="33" height="22"/>`)
	if strings.Contains(svg, `<script`) {
		t.Fatalf("svg contains script: %s", svg)
	}
}

func TestRenderHTMLIsPrettyAndInteractive(t *testing.T) {
	svg, err := RenderSVG(LayoutDocument{
		ViewBox: []float64{0, 0, 100, 80},
		Desks: []LayoutDesk{{
			ID: "desk-1", Label: "D-1", WorkplaceID: "bcchub-wp1", ComponentID: "workplace-desk-chair",
			AssetType: "workplace", X: 1, Y: 2, W: 28, H: 16,
		}},
	})
	if err != nil {
		t.Fatalf("RenderSVG failed: %v", err)
	}
	html := RenderHTML(svg, "Office Layout")
	assertContains(t, html, "\n      <svg")
	assertContains(t, html, ".workplace:hover")
	assertContains(t, html, "cursor: pointer")
	assertContains(t, html, "deskbook:workplace-click")
	if len(strings.Split(html, "\n")) < 40 {
		t.Fatalf("html is not pretty-formatted:\n%s", html)
	}
}

func TestRejectUnsafeCustomSVG(t *testing.T) {
	_, err := RenderSVG(LayoutDocument{
		Components: []LayoutComponent{{
			ID: "bad-component", AssetType: "asset", Source: "custom", ViewBox: []float64{0, 0, 10, 10},
			SVGMarkup: `<script>alert(1)</script>`,
		}},
	})
	if err == nil {
		t.Fatal("expected unsafe custom SVG to be rejected")
	}
}

func TestRenderStructureUsesEditorThicknessFallbacks(t *testing.T) {
	svg, err := RenderSVG(LayoutDocument{
		ViewBox: []float64{0, 0, 100, 80},
		Walls: []StructureElement{{
			ID: "wall-a", PTS: [][]float64{{0, 0}, {10, 0}},
		}},
		Partitions: []StructureElement{{
			ID: "partition-a", PTS: [][]float64{{0, 10}, {10, 10}},
		}},
		Doors: []StructureElement{{
			ID: "door-a", PTS: [][]float64{{0, 20}, {10, 20}},
		}},
	})
	if err != nil {
		t.Fatalf("RenderSVG failed: %v", err)
	}
	assertContains(t, svg, `class="wall" id="wall-a" points="0,0 10,0" fill="none" fill-opacity="0" stroke="#2f343b" stroke-width="4"`)
	assertContains(t, svg, `class="partition" id="partition-a" points="0,10 10,10" fill="none" fill-opacity="0" stroke="#4b5563" stroke-width="3"`)
	assertContains(t, svg, `class="door" id="door-a" points="0,20 10,20" fill="none" fill-opacity="0" stroke="#1f2937" stroke-width="2.5"`)
}

func TestRenderSVGUsesEditorBackground(t *testing.T) {
	visible := true
	svg, err := RenderSVG(LayoutDocument{
		ViewBox: []float64{0, 0, 500, 300},
		Background: &LayoutBackground{
			Image:   "data:image/png;base64,AAAA",
			Opacity: 0.42,
			Visible: &visible,
			Transform: &BackgroundTransform{
				X: 10, Y: 20, W: 300, H: 200, Rotation: 5,
			},
		},
	})
	if err != nil {
		t.Fatalf("RenderSVG failed: %v", err)
	}
	assertContains(t, svg, `class="background-plan" href="data:image/png;base64,AAAA" x="10" y="20" width="300" height="200"`)
	assertContains(t, svg, `opacity="0.42"`)
	assertContains(t, svg, `transform="rotate(5 160 120)"`)
}

func TestRenderSVGWrapsNonContiguousGroupOnce(t *testing.T) {
	svg, err := RenderSVG(LayoutDocument{
		ViewBox: []float64{0, 0, 300, 200},
		Groups: []LayoutGroup{{
			ID: "group-a", Label: "Team A", DeskIDs: []string{"desk-1", "desk-3"}, Color: "#2563eb",
		}},
		Desks: []LayoutDesk{
			{ID: "desk-1", Label: "D-1", ComponentID: "desk-short", AssetType: "desk", X: 0, Y: 0, W: 20, H: 10},
			{ID: "desk-2", Label: "D-2", ComponentID: "desk-short", AssetType: "desk", X: 40, Y: 0, W: 20, H: 10},
			{ID: "desk-3", Label: "D-3", ComponentID: "desk-short", AssetType: "desk", X: 80, Y: 0, W: 20, H: 10},
		},
	})
	if err != nil {
		t.Fatalf("RenderSVG failed: %v", err)
	}
	if count := strings.Count(svg, `class="group" id="group-a"`); count != 1 {
		t.Fatalf("expected one group wrapper, got %d\n%s", count, svg)
	}
}

func TestParseLayoutJSONPreservesEditorBackground(t *testing.T) {
	doc, err := ParseLayoutJSON([]byte(`{
		"v":1,
		"vb":[0,0,100,80],
		"background":{
			"image":"data:image/png;base64,AAAA",
			"opacity":0.42,
			"visible":false,
			"locked":true,
			"transform":{"x":10,"y":20,"w":300,"h":200,"rotation":5},
			"calibration":{"distance_m":10,"points":[[10,20],[110,20]]}
		},
		"tracing_background":{"src":"/uploads/floor.png","opacity":0.33,"visible":true}
	}`))
	if err != nil {
		t.Fatalf("ParseLayoutJSON failed: %v", err)
	}
	if doc.Background == nil {
		t.Fatal("expected background to be preserved")
	}
	if doc.Background.Image != "data:image/png;base64,AAAA" {
		t.Fatalf("unexpected background image: %q", doc.Background.Image)
	}
	if doc.Background.Visible == nil || *doc.Background.Visible {
		t.Fatalf("expected background.visible=false, got %#v", doc.Background.Visible)
	}
	if !doc.Background.Locked {
		t.Fatal("expected background.locked=true")
	}
	if doc.Background.Transform == nil || doc.Background.Transform.W != 300 || doc.Background.Transform.Rotation != 5 {
		t.Fatalf("unexpected background transform: %#v", doc.Background.Transform)
	}
	if doc.Background.Calibration == nil || doc.Background.Calibration.DistanceM != 10 || len(doc.Background.Calibration.Points) != 2 {
		t.Fatalf("unexpected background calibration: %#v", doc.Background.Calibration)
	}
	if doc.TracingBackground == nil {
		t.Fatal("expected tracing_background to be preserved")
	}

	encoded, err := json.Marshal(doc)
	if err != nil {
		t.Fatalf("Marshal failed: %v", err)
	}
	output := string(encoded)
	assertContains(t, output, `"background"`)
	assertContains(t, output, `"image":"data:image/png;base64,AAAA"`)
	assertContains(t, output, `"visible":false`)
	assertContains(t, output, `"locked":true`)
	assertContains(t, output, `"transform":{"x":10,"y":20,"w":300,"h":200,"rotation":5}`)
	assertContains(t, output, `"calibration":{"distance_m":10,"points":[[10,20],[110,20]]}`)
	assertContains(t, output, `"tracing_background"`)
	assertContains(t, output, `"src":"/uploads/floor.png"`)
}

func assertContains(t *testing.T, value string, expected string) {
	t.Helper()
	if !strings.Contains(value, expected) {
		t.Fatalf("expected output to contain %q\n--- output ---\n%s", expected, value)
	}
}
