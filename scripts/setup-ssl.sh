#!/usr/bin/env bash
# setup-ssl.sh — Obtain the initial Let's Encrypt certificate for DeskBook.
#
# Run this ONCE on the production server before starting the full TLS stack.
# After the cert is issued, switch to the SSL overlay compose file.
#
# Prerequisites:
#   - docker & docker compose installed
#   - DESKBOOK_DOMAIN DNS A record already pointing to this server
#   - Ports 80 and 443 open in the firewall
#
# Usage:
#   DESKBOOK_DOMAIN=app.example.com \
#   CERTBOT_EMAIL=admin@example.com \
#   bash scripts/setup-ssl.sh

set -euo pipefail

RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'; NC='\033[0m'

info()  { echo -e "${GREEN}[setup-ssl]${NC} $*"; }
warn()  { echo -e "${YELLOW}[setup-ssl]${NC} $*"; }
error() { echo -e "${RED}[setup-ssl] ERROR:${NC} $*" >&2; }

DOMAIN="${DESKBOOK_DOMAIN:-}"
EMAIL="${CERTBOT_EMAIL:-}"

if [[ -z "$DOMAIN" ]]; then
  error "DESKBOOK_DOMAIN is not set."
  echo "  Usage: DESKBOOK_DOMAIN=app.example.com CERTBOT_EMAIL=you@example.com bash $0"
  exit 1
fi
if [[ -z "$EMAIL" ]]; then
  error "CERTBOT_EMAIL is not set."
  exit 1
fi

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(dirname "$SCRIPT_DIR")"

cd "$PROJECT_ROOT"

# ── 1. Create certbot directories ─────────────────────────────────────────────
info "Creating certbot volume directories…"
mkdir -p ./certbot/conf ./certbot/www

# ── 2. Start a minimal HTTP-only nginx to serve the ACME challenge ─────────────
info "Starting temporary nginx for ACME challenge on port 80…"
docker run --rm -d \
  --name deskbook-acme-nginx \
  -p 80:80 \
  -v "$PROJECT_ROOT/certbot/www:/var/www/certbot:ro" \
  nginx:1.25-alpine \
  sh -c "echo 'server{listen 80;location /.well-known/acme-challenge/{root /var/www/certbot;}}' \
         > /etc/nginx/conf.d/default.conf && nginx -g 'daemon off;'"

cleanup() {
  info "Stopping temporary nginx…"
  docker stop deskbook-acme-nginx 2>/dev/null || true
}
trap cleanup EXIT

# ── 3. Run certbot to obtain the certificate ───────────────────────────────────
info "Requesting certificate for ${DOMAIN}…"
docker run --rm \
  -v "$PROJECT_ROOT/certbot/conf:/etc/letsencrypt" \
  -v "$PROJECT_ROOT/certbot/www:/var/www/certbot" \
  certbot/certbot certonly \
    --webroot \
    --webroot-path /var/www/certbot \
    --email "$EMAIL" \
    --agree-tos \
    --no-eff-email \
    -d "$DOMAIN"

info "Certificate obtained for ${DOMAIN}."

# ── 4. Done ───────────────────────────────────────────────────────────────────
echo ""
echo -e "${GREEN}✔ Certificate is ready.${NC}"
echo ""
echo "  Next steps:"
echo "    1. Bind-mount certbot/conf → /etc/letsencrypt in the admin container"
echo "       (handled automatically by docker-compose.ssl.yml)"
echo ""
echo "    2. Start the full stack with SSL overlay:"
echo "       DESKBOOK_DOMAIN=${DOMAIN} \\"
echo "       CERTBOT_EMAIL=${EMAIL} \\"
echo "       docker compose -f docker-compose.prod.yml -f docker-compose.ssl.yml up -d"
echo ""
warn "Remember: the SSL overlay replaces the admin port mapping."
warn "If you were previously running on :5175 (prod) switch to :443."
