package handler

import (
	"embed"
	"net/http"
	"strings"
)

//go:embed swagger-ui
var swaggerUIFS embed.FS

// SwaggerUIHandler serves the Swagger UI at /docs.
// GET /docs          → redirect to /docs/
// GET /docs/         → index.html with embedded Swagger UI
// GET /docs/openapi.yaml → the OpenAPI spec
func SwaggerUIHandler() http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		path := strings.TrimPrefix(r.URL.Path, "/docs")
		if path == "" {
			http.Redirect(w, r, "/docs/", http.StatusMovedPermanently)
			return
		}
		path = strings.TrimPrefix(path, "/")

		if path == "" || path == "index.html" {
			w.Header().Set("Content-Type", "text/html; charset=utf-8")
			w.WriteHeader(http.StatusOK)
			_, _ = w.Write([]byte(swaggerIndexHTML))
			return
		}

		if path == "openapi.yaml" {
			data, err := swaggerUIFS.ReadFile("swagger-ui/openapi.yaml")
			if err != nil {
				WriteError(w, http.StatusNotFound, err)
				return
			}
			w.Header().Set("Content-Type", "text/yaml; charset=utf-8")
			w.Header().Set("Access-Control-Allow-Origin", "*")
			w.WriteHeader(http.StatusOK)
			_, _ = w.Write(data)
			return
		}

		http.NotFound(w, r)
	})
}

const swaggerIndexHTML = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <title>DeskBook API — Swagger</title>
  <link rel="stylesheet" href="https://unpkg.com/swagger-ui-dist@5.18.2/swagger-ui.css">
  <style>
    html { box-sizing: border-box; overflow-y: scroll; }
    *, *::before, *::after { box-sizing: inherit; }
    body { margin: 0; background: #fafafa; }
    .topbar { display: none !important; }
  </style>
</head>
<body>
  <div id="swagger-ui"></div>
  <script src="https://unpkg.com/swagger-ui-dist@5.18.2/swagger-ui-bundle.js"></script>
  <script>
    SwaggerUIBundle({
      url: '/docs/openapi.yaml',
      dom_id: '#swagger-ui',
      deepLinking: true,
      presets: [
        SwaggerUIBundle.presets.apis,
        SwaggerUIBundle.SwaggerUIStandalonePreset
      ],
      layout: 'BaseLayout',
      supportedSubmitMethods: [] // Read-only / interactive docs
    });
  </script>
</body>
</html>`
