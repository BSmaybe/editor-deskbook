package svgimport

import (
	"crypto/rand"
	"encoding/xml"
	"errors"
	"fmt"
	"io"
	"math"
	"regexp"
	"strconv"
	"strings"
	"time"
)

const maxSVGBytes = 5 * 1024 * 1024

var (
	transformFnRE = regexp.MustCompile(`([A-Za-z]+)\s*\(([^)]*)\)`)
	numRE         = regexp.MustCompile(`[-+]?[0-9]*\.?[0-9]+([eE][-+]?[0-9]+)?`)
	pathTokenRE   = regexp.MustCompile(`[MmLlHhVvCcSsQqTtAaZz]|[-+]?[0-9]*\.?[0-9]+([eE][-+]?[0-9]+)?`)

	geomTags = map[string]bool{
		"line": true, "polyline": true, "polygon": true, "rect": true, "path": true,
	}
	skipContainerTags = map[string]bool{
		"defs": true, "symbol": true, "marker": true, "clippath": true, "mask": true, "pattern": true,
	}
)

type ImportResult struct {
	Walls      []StructureElement `json:"walls"`
	Boundaries []StructureElement `json:"boundaries"`
	Partitions []StructureElement `json:"partitions"`
	Doors      []StructureElement `json:"doors"`
	Uncertain  []StructureElement `json:"uncertain"`
	Stats      ImportStats        `json:"stats"`
	VB         []float64          `json:"vb"`
}

type ImportStats struct {
	TotalElements int `json:"total_elements"`
	Walls         int `json:"walls"`
	Boundaries    int `json:"boundaries"`
	Partitions    int `json:"partitions"`
	Doors         int `json:"doors"`
	Uncertain     int `json:"uncertain"`
	Skipped       int `json:"skipped"`
}

type StructureElement struct {
	ID         string      `json:"id"`
	PTS        [][]float64 `json:"pts"`
	Thick      float64     `json:"thick"`
	Closed     bool        `json:"closed"`
	Label      *string     `json:"label"`
	LabelSize  *float64    `json:"label_size"`
	LabelPos   *string     `json:"label_pos"`
	LabelAngle *float64    `json:"label_angle"`
	Color      *string     `json:"color"`
	Locked     bool        `json:"locked"`
	Conf       float64     `json:"conf"`
}

type svgNode struct {
	Name     string
	Attr     map[string]string
	Children []*svgNode
}

type matrix [6]float64

type openElement struct {
	PTS       [][]float64
	SW        float64
	HasFill   bool
	HasStroke bool
	FillRaw   string
}

func Classify(rawSVG string) (ImportResult, error) {
	if strings.Contains(rawSVG, "<!DOCTYPE") || strings.Contains(rawSVG, "<!ENTITY") {
		return ImportResult{}, errors.New("DOCTYPE/ENTITY not allowed")
	}
	if len([]byte(rawSVG)) > maxSVGBytes {
		return ImportResult{}, errors.New("SVG too large (max 5 MB)")
	}

	root, err := parseXML(rawSVG)
	if err != nil {
		return ImportResult{}, fmt.Errorf("SVG parse error: %v", err)
	}
	if strings.ToLower(root.Name) != "svg" {
		return ImportResult{}, errors.New("Root element must be <svg>")
	}

	vb := parseViewBox(root)
	vbArea := vb[2] * vb[3]
	if vb[2] == 0 || vb[3] == 0 {
		vbArea = 1e6
	}
	vbDiag := math.Hypot(vb[2], vb[3])
	if vb[2] == 0 || vb[3] == 0 {
		vbDiag = 1500
	}

	walls := []StructureElement{}
	boundaries := []StructureElement{}
	partitions := []StructureElement{}
	doors := []StructureElement{}
	uncertain := []StructureElement{}
	openElements := []openElement{}
	skipped := 0

	tinyArea := math.Max(vbArea*0.00002, 4)
	minOpenLen := math.Max(vbDiag*0.015, 8)
	longOpenLen := math.Max(vbDiag*0.05, 28)
	minClosedLen := math.Max(vbDiag*0.03, 18)
	minDoorLen := math.Max(vbDiag*0.006, 6)
	maxDoorLen := math.Min(math.Max(vbDiag*0.03, 16), 34)
	maxDoorArea := math.Min(math.Max(tinyArea*25, 140), math.Max(vbArea*0.003, 280))

	var walk func(*svgNode, matrix, bool)
	walk = func(el *svgNode, inherited matrix, inSkipContainer bool) {
		tagL := strings.ToLower(el.Name)
		mat := matMul(inherited, parseTransform(el))
		nowSkip := inSkipContainer || skipContainerTags[tagL]

		if geomTags[tagL] {
			if nowSkip {
				skipped++
			} else {
				pts, closed := parseGeometry(tagL, el)
				if len(pts) < 2 {
					skipped++
				} else {
					pts = applyTransform(pts, mat)
					pts = simplifyCollinear(pts, 8)
					if len(pts) < 2 {
						skipped++
						return
					}
					sw := strokeWidth(el)
					hasFill := hasFill(el)
					hasStroke := hasStroke(el)
					fillRaw := strings.ToLower(strings.TrimSpace(firstNonEmpty(attr(el, "fill"), styleProp(el, "fill"))))
					length := length(pts)
					area := bboxArea(pts)

					switch {
					case closed && strings.HasPrefix(fillRaw, "url("):
						skipped++
					case closed && hasFill && area >= vbArea*0.9 && sw <= 1.2 && !hasStroke:
						skipped++
					case area <= tinyArea && length <= minOpenLen:
						skipped++
					case closed:
						elData := newStructureElement(pts, true)
						if hasFill && area > vbArea*0.001 {
							elData.Thick = math.Max(sw, 1.6)
							if area > vbArea*0.01 {
								elData.Conf = 0.82
							} else {
								elData.Conf = 0.66
							}
							boundaries = append(boundaries, elData)
						} else if hasStroke && (length >= minClosedLen || area >= tinyArea*10) {
							elData.Thick = math.Max(sw, 1.2)
							elData.Conf = 0.72
							boundaries = append(boundaries, elData)
						} else {
							skipped++
						}
					default:
						openElements = append(openElements, openElement{
							PTS:       pts,
							SW:        sw,
							HasFill:   hasFill,
							HasStroke: hasStroke,
							FillRaw:   fillRaw,
						})
					}
				}
			}
		} else if tagL != "svg" && tagL != "g" && tagL != "defs" && tagL != "title" && tagL != "desc" {
			skipped++
		}

		for _, child := range el.Children {
			walk(child, mat, nowSkip)
		}
	}

	walk(root, identityMatrix(), false)

	openElements = mergeOpenSegments(openElements, math.Max(vbDiag*0.0022, 2), 12)
	for _, raw := range openElements {
		pts := simplifyCollinear(raw.PTS, 7)
		if len(pts) < 2 {
			skipped++
			continue
		}
		sw := raw.SW
		length := length(pts)
		area := bboxArea(pts)
		if area <= tinyArea && length <= minOpenLen*0.7 {
			skipped++
			continue
		}

		elData := newStructureElement(pts, false)
		doorShape := len(pts) >= 3 || !isAxisAligned(pts[0], pts[len(pts)-1], math.Max(vbDiag*0.0004, 0.7))
		isDoorLike := raw.HasStroke &&
			sw <= 2.2 &&
			minDoorLen <= length && length <= maxDoorLen &&
			area <= maxDoorArea &&
			len(pts) <= 10 &&
			doorShape

		switch {
		case isDoorLike:
			elData.Thick = math.Max(sw, 1)
			elData.Conf = 0.8
			doors = append(doors, elData)
		case raw.HasStroke && sw >= 2.5 && length >= minOpenLen:
			elData.Thick = math.Max(sw, 2.5)
			elData.Conf = 0.86
			walls = append(walls, elData)
		case raw.HasStroke && length >= minOpenLen:
			elData.Thick = math.Max(sw, 1)
			elData.Conf = 0.76
			partitions = append(partitions, elData)
		case length >= longOpenLen:
			elData.Thick = math.Max(sw, 1)
			elData.Conf = 0.45
			uncertain = append(uncertain, elData)
		default:
			skipped++
		}
	}

	stats := ImportStats{
		TotalElements: len(walls) + len(boundaries) + len(partitions) + len(doors) + len(uncertain) + skipped,
		Walls:         len(walls),
		Boundaries:    len(boundaries),
		Partitions:    len(partitions),
		Doors:         len(doors),
		Uncertain:     len(uncertain),
		Skipped:       skipped,
	}
	return ImportResult{
		Walls:      walls,
		Boundaries: boundaries,
		Partitions: partitions,
		Doors:      doors,
		Uncertain:  uncertain,
		Stats:      stats,
		VB:         vb,
	}, nil
}

func parseXML(raw string) (*svgNode, error) {
	decoder := xml.NewDecoder(strings.NewReader(raw))
	for {
		token, err := decoder.Token()
		if errors.Is(err, io.EOF) {
			return nil, errors.New("empty XML document")
		}
		if err != nil {
			return nil, err
		}
		if start, ok := token.(xml.StartElement); ok {
			return parseElement(decoder, start)
		}
	}
}

func parseElement(decoder *xml.Decoder, start xml.StartElement) (*svgNode, error) {
	node := &svgNode{Name: strings.ToLower(start.Name.Local), Attr: map[string]string{}}
	for _, item := range start.Attr {
		node.Attr[item.Name.Local] = item.Value
		if item.Name.Space != "" {
			node.Attr[item.Name.Space+":"+item.Name.Local] = item.Value
		}
	}
	for {
		token, err := decoder.Token()
		if err != nil {
			return nil, err
		}
		switch value := token.(type) {
		case xml.StartElement:
			child, err := parseElement(decoder, value)
			if err != nil {
				return nil, err
			}
			node.Children = append(node.Children, child)
		case xml.EndElement:
			if value.Name.Local == start.Name.Local {
				return node, nil
			}
		}
	}
}

func attr(el *svgNode, name string) string {
	if el == nil || el.Attr == nil {
		return ""
	}
	return el.Attr[name]
}

func styleProp(el *svgNode, name string) string {
	style := attr(el, "style")
	if strings.TrimSpace(style) == "" {
		return ""
	}
	for _, part := range strings.Split(style, ";") {
		key, value, ok := strings.Cut(part, ":")
		if !ok {
			continue
		}
		if strings.TrimSpace(key) == name {
			return strings.TrimSpace(value)
		}
	}
	return ""
}

func strokeWidth(el *svgNode) float64 {
	stroke := strings.ToLower(strings.TrimSpace(attr(el, "stroke")))
	styleStroke := strings.ToLower(strings.TrimSpace(styleProp(el, "stroke")))
	if (stroke == "" || stroke == "none") && (styleStroke == "" || styleStroke == "none") {
		return 0
	}
	sw := attr(el, "stroke-width")
	if sw == "" {
		sw = styleProp(el, "stroke-width")
	}
	if sw == "" {
		return 1
	}
	value, err := strconv.ParseFloat(sw, 64)
	if err != nil {
		return 1
	}
	return value
}

func hasStroke(el *svgNode) bool {
	stroke := strings.ToLower(strings.TrimSpace(attr(el, "stroke")))
	if stroke != "" && stroke != "none" {
		return true
	}
	styleStroke := strings.ToLower(strings.TrimSpace(styleProp(el, "stroke")))
	return styleStroke != "" && styleStroke != "none"
}

func hasFill(el *svgNode) bool {
	fill := strings.ToLower(strings.TrimSpace(attr(el, "fill")))
	styleFill := strings.ToLower(strings.TrimSpace(styleProp(el, "fill")))
	if styleFill == "none" || fill == "none" {
		return false
	}
	if styleFill != "" {
		return true
	}
	return fill != ""
}

func parseViewBox(root *svgNode) []float64 {
	raw := firstNonEmpty(attr(root, "viewBox"), attr(root, "viewbox"))
	if parts := strings.FieldsFunc(raw, func(r rune) bool { return r == ' ' || r == '\t' || r == '\n' || r == '\r' || r == ',' }); len(parts) >= 4 {
		out := make([]float64, 4)
		ok := true
		for i := 0; i < 4; i++ {
			value, err := strconv.ParseFloat(parts[i], 64)
			if err != nil {
				ok = false
				break
			}
			out[i] = value
		}
		if ok {
			return out
		}
	}
	w := parseFloatDefault(attr(root, "width"), 1000)
	h := parseFloatDefault(attr(root, "height"), 1000)
	return []float64{0, 0, w, h}
}

func parseGeometry(tag string, el *svgNode) ([][]float64, bool) {
	switch tag {
	case "line":
		return linePts(el), false
	case "polyline":
		return polylinePts(el), false
	case "polygon":
		return polylinePts(el), true
	case "rect":
		return rectPts(el), true
	case "path":
		d := attr(el, "d")
		return pathApproxPts(d), pathIsClosed(d)
	default:
		return nil, false
	}
}

func linePts(el *svgNode) [][]float64 {
	x1, ok1 := parseFloat(attr(el, "x1"))
	y1, ok2 := parseFloat(attr(el, "y1"))
	x2, ok3 := parseFloat(attr(el, "x2"))
	y2, ok4 := parseFloat(attr(el, "y2"))
	if !ok1 {
		x1 = 0
	}
	if !ok2 {
		y1 = 0
	}
	if !ok3 {
		x2 = 0
	}
	if !ok4 {
		y2 = 0
	}
	return [][]float64{{x1, y1}, {x2, y2}}
}

func polylinePts(el *svgNode) [][]float64 {
	parts := strings.FieldsFunc(attr(el, "points"), func(r rune) bool {
		return r == ' ' || r == '\t' || r == '\n' || r == '\r' || r == ','
	})
	out := [][]float64{}
	for i := 0; i+1 < len(parts); i += 2 {
		x, xOK := parseFloat(parts[i])
		y, yOK := parseFloat(parts[i+1])
		if xOK && yOK {
			out = append(out, []float64{x, y})
		}
	}
	return out
}

func rectPts(el *svgNode) [][]float64 {
	x := parseFloatDefault(attr(el, "x"), 0)
	y := parseFloatDefault(attr(el, "y"), 0)
	w := parseFloatDefault(attr(el, "width"), 0)
	h := parseFloatDefault(attr(el, "height"), 0)
	return [][]float64{{x, y}, {x + w, y}, {x + w, y + h}, {x, y + h}}
}

func pathIsClosed(d string) bool {
	return strings.ContainsAny(d, "Zz")
}

func pathApproxPts(d string) [][]float64 {
	pts := [][]float64{}
	cx, cy := 0.0, 0.0
	sx, sy := 0.0, 0.0
	cmd := ""
	tokens := pathTokenRE.FindAllString(d, -1)
	i := 0

	isCmd := func(token string) bool {
		return len(token) == 1 && strings.ContainsAny(token, "MmLlHhVvCcSsQqTtAaZz")
	}
	take := func(token string) float64 {
		value, _ := strconv.ParseFloat(token, 64)
		return value
	}

	for i < len(tokens) {
		token := tokens[i]
		if isCmd(token) {
			cmd = token
			i++
			if cmd == "Z" || cmd == "z" {
				cx, cy = sx, sy
				pts = append(pts, []float64{cx, cy})
				continue
			}
		} else if cmd == "" {
			i++
			continue
		}

		switch cmd {
		case "M", "m":
			first := true
			for i+1 < len(tokens) && !isCmd(tokens[i]) {
				x, y := take(tokens[i]), take(tokens[i+1])
				i += 2
				if cmd == "m" {
					x += cx
					y += cy
				}
				cx, cy = x, y
				if first {
					sx, sy = cx, cy
					first = false
				}
				pts = append(pts, []float64{cx, cy})
				if cmd == "m" {
					cmd = "l"
				} else {
					cmd = "L"
				}
			}
		case "L", "l":
			for i+1 < len(tokens) && !isCmd(tokens[i]) {
				x, y := take(tokens[i]), take(tokens[i+1])
				i += 2
				if cmd == "l" {
					x += cx
					y += cy
				}
				cx, cy = x, y
				pts = append(pts, []float64{cx, cy})
			}
		case "H", "h":
			for i < len(tokens) && !isCmd(tokens[i]) {
				x := take(tokens[i])
				i++
				if cmd == "h" {
					cx += x
				} else {
					cx = x
				}
				pts = append(pts, []float64{cx, cy})
			}
		case "V", "v":
			for i < len(tokens) && !isCmd(tokens[i]) {
				y := take(tokens[i])
				i++
				if cmd == "v" {
					cy += y
				} else {
					cy = y
				}
				pts = append(pts, []float64{cx, cy})
			}
		case "C", "c":
			for i+5 < len(tokens) && !isCmd(tokens[i]) {
				x, y := take(tokens[i+4]), take(tokens[i+5])
				i += 6
				if cmd == "c" {
					x += cx
					y += cy
				}
				cx, cy = x, y
				pts = append(pts, []float64{cx, cy})
			}
		case "S", "s", "Q", "q":
			step := 4
			for i+step-1 < len(tokens) && !isCmd(tokens[i]) {
				x, y := take(tokens[i+step-2]), take(tokens[i+step-1])
				i += step
				if cmd == "s" || cmd == "q" {
					x += cx
					y += cy
				}
				cx, cy = x, y
				pts = append(pts, []float64{cx, cy})
			}
		case "T", "t":
			for i+1 < len(tokens) && !isCmd(tokens[i]) {
				x, y := take(tokens[i]), take(tokens[i+1])
				i += 2
				if cmd == "t" {
					x += cx
					y += cy
				}
				cx, cy = x, y
				pts = append(pts, []float64{cx, cy})
			}
		case "A", "a":
			for i+6 < len(tokens) && !isCmd(tokens[i]) {
				x, y := take(tokens[i+5]), take(tokens[i+6])
				i += 7
				if cmd == "a" {
					x += cx
					y += cy
				}
				cx, cy = x, y
				pts = append(pts, []float64{cx, cy})
			}
		default:
			i++
		}
	}
	return pts
}

func identityMatrix() matrix {
	return matrix{1, 0, 0, 1, 0, 0}
}

func matMul(m1, m2 matrix) matrix {
	a1, b1, c1, d1, e1, f1 := m1[0], m1[1], m1[2], m1[3], m1[4], m1[5]
	a2, b2, c2, d2, e2, f2 := m2[0], m2[1], m2[2], m2[3], m2[4], m2[5]
	return matrix{
		a1*a2 + c1*b2,
		b1*a2 + d1*b2,
		a1*c2 + c1*d2,
		b1*c2 + d1*d2,
		a1*e2 + c1*f2 + e1,
		b1*e2 + d1*f2 + f1,
	}
}

func translate(tx, ty float64) matrix {
	return matrix{1, 0, 0, 1, tx, ty}
}

func scale(sx, sy float64) matrix {
	return matrix{sx, 0, 0, sy, 0, 0}
}

func rotate(deg float64) matrix {
	rad := deg * math.Pi / 180
	return matrix{math.Cos(rad), math.Sin(rad), -math.Sin(rad), math.Cos(rad), 0, 0}
}

func skewX(deg float64) matrix {
	return matrix{1, 0, math.Tan(deg * math.Pi / 180), 1, 0, 0}
}

func skewY(deg float64) matrix {
	return matrix{1, math.Tan(deg * math.Pi / 180), 0, 1, 0, 0}
}

func parseTransform(el *svgNode) matrix {
	raw := strings.TrimSpace(attr(el, "transform"))
	if raw == "" {
		return identityMatrix()
	}
	out := identityMatrix()
	for _, match := range transformFnRE.FindAllStringSubmatch(raw, -1) {
		name := strings.ToLower(strings.TrimSpace(match[1]))
		nums := parseNumbers(match[2])
		cur := identityMatrix()
		switch {
		case name == "matrix" && len(nums) >= 6:
			cur = matrix{nums[0], nums[1], nums[2], nums[3], nums[4], nums[5]}
		case name == "translate":
			tx := valueAt(nums, 0, 0)
			ty := valueAt(nums, 1, 0)
			cur = translate(tx, ty)
		case name == "scale":
			sx := valueAt(nums, 0, 1)
			sy := valueAt(nums, 1, sx)
			cur = scale(sx, sy)
		case name == "rotate":
			ang := valueAt(nums, 0, 0)
			if len(nums) >= 3 {
				cx, cy := nums[1], nums[2]
				cur = matMul(translate(cx, cy), matMul(rotate(ang), translate(-cx, -cy)))
			} else {
				cur = rotate(ang)
			}
		case name == "skewx" && len(nums) > 0:
			cur = skewX(nums[0])
		case name == "skewy" && len(nums) > 0:
			cur = skewY(nums[0])
		}
		out = matMul(out, cur)
	}
	return out
}

func applyTransform(pts [][]float64, m matrix) [][]float64 {
	out := make([][]float64, 0, len(pts))
	a, b, c, d, e, f := m[0], m[1], m[2], m[3], m[4], m[5]
	for _, p := range pts {
		if len(p) < 2 {
			continue
		}
		x, y := p[0], p[1]
		out = append(out, []float64{a*x + c*y + e, b*x + d*y + f})
	}
	return out
}

func length(pts [][]float64) float64 {
	total := 0.0
	for i := 1; i < len(pts); i++ {
		total += dist(pts[i-1], pts[i])
	}
	return total
}

func bboxArea(pts [][]float64) float64 {
	if len(pts) == 0 {
		return 0
	}
	minX, maxX := pts[0][0], pts[0][0]
	minY, maxY := pts[0][1], pts[0][1]
	for _, p := range pts[1:] {
		minX = math.Min(minX, p[0])
		maxX = math.Max(maxX, p[0])
		minY = math.Min(minY, p[1])
		maxY = math.Max(maxY, p[1])
	}
	return (maxX - minX) * (maxY - minY)
}

func dist(a, b []float64) float64 {
	if len(a) < 2 || len(b) < 2 {
		return 0
	}
	return math.Hypot(a[0]-b[0], a[1]-b[1])
}

func dedupePts(pts [][]float64, eps float64) [][]float64 {
	out := [][]float64{}
	for _, p := range pts {
		if len(p) < 2 {
			continue
		}
		if len(out) == 0 || dist(out[len(out)-1], p) > eps {
			out = append(out, []float64{p[0], p[1]})
		}
	}
	if len(out) >= 2 && dist(out[0], out[len(out)-1]) <= eps {
		out = out[:len(out)-1]
	}
	return out
}

func simplifyCollinear(pts [][]float64, angleTolDeg float64) [][]float64 {
	pts = dedupePts(pts, 1e-6)
	if len(pts) < 3 {
		return pts
	}
	sinTol := math.Sin(angleTolDeg * math.Pi / 180)
	out := [][]float64{pts[0]}
	for i := 1; i < len(pts)-1; i++ {
		a := out[len(out)-1]
		b := pts[i]
		c := pts[i+1]
		v1x, v1y := b[0]-a[0], b[1]-a[1]
		v2x, v2y := c[0]-b[0], c[1]-b[1]
		l1, l2 := math.Hypot(v1x, v1y), math.Hypot(v2x, v2y)
		if l1 <= 1e-6 || l2 <= 1e-6 {
			continue
		}
		cross := math.Abs(v1x*v2y-v1y*v2x) / (l1 * l2)
		dot := (v1x*v2x + v1y*v2y) / (l1 * l2)
		if cross <= sinTol && dot > 0 {
			continue
		}
		out = append(out, b)
	}
	out = append(out, pts[len(pts)-1])
	return dedupePts(out, 1e-6)
}

func tryExtendChain(chain [][]float64, segPts [][]float64, atEnd bool, endpointTol float64, cosTol float64) ([][]float64, float64, bool) {
	if len(chain) < 2 || len(segPts) != 2 {
		return nil, 0, false
	}
	var anchor, prev []float64
	if atEnd {
		anchor = chain[len(chain)-1]
		prev = chain[len(chain)-2]
	} else {
		anchor = chain[0]
		prev = chain[1]
	}
	dirX, dirY := anchor[0]-prev[0], anchor[1]-prev[1]
	dirLen := math.Hypot(dirX, dirY)
	bestDist := math.Inf(1)
	var best [][]float64

	pairs := [][2][]float64{{segPts[0], segPts[1]}, {segPts[1], segPts[0]}}
	for _, pair := range pairs {
		near, far := pair[0], pair[1]
		d := dist(anchor, near)
		if d > endpointTol {
			continue
		}
		vx, vy := far[0]-anchor[0], far[1]-anchor[1]
		vLen := math.Hypot(vx, vy)
		if vLen <= 1e-6 {
			continue
		}
		if dirLen > 1e-6 {
			cosV := (dirX*vx + dirY*vy) / (dirLen * vLen)
			if cosV < cosTol {
				continue
			}
		}
		candidate := clonePts(chain)
		if atEnd {
			candidate = append(candidate, []float64{far[0], far[1]})
		} else {
			candidate = append([][]float64{{far[0], far[1]}}, candidate...)
		}
		if d < bestDist {
			best = candidate
			bestDist = d
		}
	}
	if best == nil {
		return nil, 0, false
	}
	return best, bestDist, true
}

func mergeOpenSegments(openElements []openElement, endpointTol float64, angleTolDeg float64) []openElement {
	if len(openElements) < 2 {
		return openElements
	}
	cosTol := math.Cos(angleTolDeg * math.Pi / 180)
	mergeable := []openElement{}
	passthrough := []openElement{}
	for _, el := range openElements {
		if el.HasStroke && !el.HasFill && len(el.PTS) == 2 {
			mergeable = append(mergeable, el)
		} else {
			passthrough = append(passthrough, el)
		}
	}
	if len(mergeable) < 2 {
		return openElements
	}

	used := make([]bool, len(mergeable))
	merged := []openElement{}
	for i, base := range mergeable {
		if used[i] {
			continue
		}
		used[i] = true
		chain := clonePts(base.PTS)
		swWeight := math.Max(length(chain), 1)
		swSum := base.SW * swWeight

		for {
			bestIdx := -1
			bestDist := math.Inf(1)
			var bestChain [][]float64
			for j, candidate := range mergeable {
				if used[j] {
					continue
				}
				swA, swB := base.SW, candidate.SW
				if math.Abs(swA-swB) > math.Max(0.9, 0.35*math.Max(swA, swB)) {
					continue
				}
				for _, atEnd := range []bool{true, false} {
					newChain, d, ok := tryExtendChain(chain, candidate.PTS, atEnd, endpointTol, cosTol)
					if ok && d < bestDist {
						bestIdx = j
						bestChain = newChain
						bestDist = d
					}
				}
			}
			if bestIdx < 0 || bestChain == nil {
				break
			}
			used[bestIdx] = true
			chain = bestChain
			segLen := math.Max(length(mergeable[bestIdx].PTS), 1)
			swWeight += segLen
			swSum += mergeable[bestIdx].SW * segLen
		}

		chain = simplifyCollinear(chain, 7)
		sw := base.SW
		if swWeight > 0 {
			sw = swSum / swWeight
		}
		merged = append(merged, openElement{
			PTS:       chain,
			SW:        sw,
			HasFill:   false,
			HasStroke: true,
		})
	}
	return append(passthrough, merged...)
}

func isAxisAligned(a, b []float64, tol float64) bool {
	if len(a) < 2 || len(b) < 2 {
		return true
	}
	return math.Abs(a[0]-b[0]) <= tol || math.Abs(a[1]-b[1]) <= tol
}

func newStructureElement(pts [][]float64, closed bool) StructureElement {
	return StructureElement{
		ID:     uuidV4(),
		PTS:    pts,
		Thick:  4,
		Closed: closed,
		Locked: false,
		Conf:   1,
	}
}

func parseNumbers(raw string) []float64 {
	matches := numRE.FindAllString(raw, -1)
	out := make([]float64, 0, len(matches))
	for _, item := range matches {
		value, err := strconv.ParseFloat(item, 64)
		if err == nil {
			out = append(out, value)
		}
	}
	return out
}

func parseFloat(raw string) (float64, bool) {
	value, err := strconv.ParseFloat(strings.TrimSpace(raw), 64)
	return value, err == nil
}

func parseFloatDefault(raw string, fallback float64) float64 {
	value, ok := parseFloat(raw)
	if !ok {
		return fallback
	}
	return value
}

func valueAt(values []float64, index int, fallback float64) float64 {
	if index < len(values) {
		return values[index]
	}
	return fallback
}

func firstNonEmpty(values ...string) string {
	for _, value := range values {
		if strings.TrimSpace(value) != "" {
			return value
		}
	}
	return ""
}

func clonePts(pts [][]float64) [][]float64 {
	out := make([][]float64, 0, len(pts))
	for _, p := range pts {
		if len(p) >= 2 {
			out = append(out, []float64{p[0], p[1]})
		}
	}
	return out
}

func uuidV4() string {
	var b [16]byte
	if _, err := rand.Read(b[:]); err != nil {
		return "svgimport-" + strconv.FormatInt(time.Now().UnixNano(), 10)
	}
	b[6] = (b[6] & 0x0f) | 0x40
	b[8] = (b[8] & 0x3f) | 0x80
	return fmt.Sprintf("%x-%x-%x-%x-%x", b[0:4], b[4:6], b[6:8], b[8:10], b[10:16])
}
