package migrations

import "embed"

// EmbedFS embeds the migrations directory
//go:embed *.sql
var EmbedFS embed.FS
