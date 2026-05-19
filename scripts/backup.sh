#!/usr/bin/env bash
# Backup DeskBook PostgreSQL database.
# Usage: bash scripts/backup.sh [output_dir]
# Reads credentials from .env or environment variables.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"
BACKUP_DIR="${1:-${PROJECT_DIR}/backups}"

if [ -f "${PROJECT_DIR}/.env" ]; then
  set -a
  source "${PROJECT_DIR}/.env"
  set +a
fi

DB_HOST="${POSTGRES_HOST:-localhost}"
DB_PORT="${POSTGRES_PORT:-5432}"
DB_USER="${POSTGRES_USER:-deskbook}"
DB_NAME="${POSTGRES_DB:-deskbook}"

mkdir -p "$BACKUP_DIR"

TIMESTAMP="$(date +%Y%m%d_%H%M%S)"
FILENAME="deskbook_${TIMESTAMP}.sql.gz"
FILEPATH="${BACKUP_DIR}/${FILENAME}"

echo "Backing up ${DB_NAME}@${DB_HOST}:${DB_PORT} -> ${FILEPATH}"

PGPASSWORD="${POSTGRES_PASSWORD}" pg_dump \
  -h "$DB_HOST" \
  -p "$DB_PORT" \
  -U "$DB_USER" \
  -d "$DB_NAME" \
  --no-owner \
  --no-privileges \
  --format=plain \
  | gzip > "$FILEPATH"

SIZE="$(du -h "$FILEPATH" | cut -f1)"
echo "Backup complete: ${FILEPATH} (${SIZE})"

# Keep last 30 backups, remove older
ls -t "${BACKUP_DIR}"/deskbook_*.sql.gz 2>/dev/null | tail -n +31 | xargs rm -f 2>/dev/null || true
echo "Retention: keeping last 30 backups"
