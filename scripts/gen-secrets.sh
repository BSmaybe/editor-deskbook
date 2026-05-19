#!/usr/bin/env bash
# Generate a production .env file with random secrets.
# Usage: bash scripts/gen-secrets.sh [output_file]
# Default output: .env.production

set -euo pipefail

OUTPUT="${1:-.env.production}"

if [ -f "$OUTPUT" ]; then
  echo "File ${OUTPUT} already exists. Remove it first or specify a different path."
  exit 1
fi

rand() { openssl rand -hex "$1"; }

SECRET_KEY="$(rand 32)"
DB_PASSWORD="$(rand 16)"
ADMIN_PASSWORD="$(rand 12)"

cat > "$OUTPUT" <<EOF
POSTGRES_USER=deskbook
POSTGRES_PASSWORD=${DB_PASSWORD}
POSTGRES_DB=deskbook
DATABASE_URL=postgresql://deskbook:${DB_PASSWORD}@postgres:5432/deskbook

SECRET_KEY=${SECRET_KEY}

BOOTSTRAP_ADMIN_EMAIL=admin@yourcompany.com
BOOTSTRAP_ADMIN_PASSWORD=${ADMIN_PASSWORD}
BOOTSTRAP_ADMIN_USERNAME=admin

APP_ENV=production
EOF

echo "Generated ${OUTPUT}"
echo ""
echo "  SECRET_KEY:       ${SECRET_KEY:0:8}..."
echo "  DB password:      ${DB_PASSWORD:0:4}..."
echo "  Admin password:   ${ADMIN_PASSWORD}"
echo ""
echo "IMPORTANT: Update BOOTSTRAP_ADMIN_EMAIL to a real address."
echo "After first startup, change the admin password via the UI."
