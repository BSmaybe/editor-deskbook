package exporter

import (
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

func assertContains(t *testing.T, value string, expected string) {
	t.Helper()
	if !strings.Contains(value, expected) {
		t.Fatalf("expected output to contain %q\n--- output ---\n%s", expected, value)
	}
}
