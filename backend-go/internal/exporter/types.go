package exporter

type LayoutDocument struct {
	Version           int                  `json:"v"`
	ViewBox           []float64            `json:"vb"`
	BuildingID        string               `json:"building_id"`
	StoreyID          string               `json:"storey_id"`
	ZoneID            string               `json:"zone_id"`
	BgURL             string               `json:"bg_url"`
	BgTransform       *BackgroundTransform `json:"bg_transform"`
	Background        *LayoutBackground    `json:"background,omitempty"`
	TracingBackground *LayoutBackground    `json:"tracing_background,omitempty"`
	Components        []LayoutComponent    `json:"components"`
	Walls             []StructureElement   `json:"walls"`
	Boundaries        []StructureElement   `json:"boundaries"`
	Partitions        []StructureElement   `json:"partitions"`
	Doors             []StructureElement   `json:"doors"`
	Desks             []LayoutDesk         `json:"desks"`
	Groups            []LayoutGroup        `json:"groups,omitempty"`
	Zones             []LayoutZone         `json:"zones,omitempty"`
	InfraLayers       []InfraLayer         `json:"infra_layers,omitempty"`
	PixelsPerMeter    float64              `json:"pixels_per_meter,omitempty"`
}

// InfraItem — a single polyline within an infrastructure layer.
type InfraItem struct {
	ID  string      `json:"id"`
	PTS [][]float64 `json:"pts"`
}

// InfraLayer — engineering services layer (cables, water, HVAC, etc.)
type InfraLayer struct {
	ID      string      `json:"id"`
	Name    string      `json:"name"`
	Color   string      `json:"color"`
	Visible *bool       `json:"visible,omitempty"`
	Items   []InfraItem `json:"items"`
}

// LayoutZone — named coloured area (kitchen, focus, reception, etc.)
// rendered as a filled polygon below all desks.
type LayoutZone struct {
	ID    string      `json:"id"`
	Label string      `json:"label"`
	Type  string      `json:"type"`  // kitchen|reception|chill|focus|meeting|open_space|custom
	Color string      `json:"color"` // hex, e.g. "#fef9c3"
	PTS   [][]float64 `json:"pts"`   // polygon points [[x,y],...]
}

type LayoutGroup struct {
	ID      string   `json:"id"`
	Label   string   `json:"label"`
	DeskIDs []string `json:"desk_ids"`
	Locked  bool     `json:"locked"`
	Color   string   `json:"color,omitempty"`
}

type BackgroundTransform struct {
	X float64 `json:"x"`
	Y float64 `json:"y"`
	W float64 `json:"w"`
	H float64 `json:"h"`
}

type LayoutBackground struct {
	Image   string  `json:"image,omitempty"`
	Src     string  `json:"src,omitempty"`
	Href    string  `json:"href,omitempty"`
	Opacity float64 `json:"opacity,omitempty"`
	Visible *bool   `json:"visible,omitempty"`
}

type LayoutComponent struct {
	ID        string    `json:"id"`
	Label     string    `json:"label"`
	AssetType string    `json:"asset_type"`
	Source    string    `json:"source"`
	ViewBox   []float64 `json:"view_box"`
	DefaultW  float64   `json:"default_w"`
	DefaultH  float64   `json:"default_h"`
	SVGMarkup string    `json:"svg_markup"`
}

type StructureElement struct {
	ID     string      `json:"id"`
	Kind   string      `json:"kind"`
	PTS    [][]float64 `json:"pts"`
	Thick  float64     `json:"thick"`
	Color  string      `json:"color"`
	Closed bool        `json:"closed"`
	Label  string      `json:"label"`
	Locked bool        `json:"locked"`
}

type LayoutDesk struct {
	ID              string  `json:"id"`
	Label           string  `json:"label"`
	InventoryNumber string  `json:"inventory_number"`
	Name            string  `json:"name"`
	Team            string  `json:"team"`
	Dept            string  `json:"dept"`
	BuildingID      string  `json:"building_id"`
	StoreyID        string  `json:"storey_id"`
	ZoneID          string  `json:"zone_id"`
	WorkplaceID     string  `json:"workplace_id"`
	ComponentID     string  `json:"component_id"`
	SymbolID        string  `json:"symbol_id"`
	AssetType       string  `json:"asset_type"`
	Bookable        bool    `json:"bookable"`
	Fixed           bool    `json:"fixed"`
	AssignedTo      string  `json:"assigned_to"`
	Status          string  `json:"status"`
	X               float64 `json:"x"`
	Y               float64 `json:"y"`
	W               float64 `json:"w"`
	H               float64 `json:"h"`
	R               float64 `json:"r"`
	Locked          bool    `json:"locked"`
}
