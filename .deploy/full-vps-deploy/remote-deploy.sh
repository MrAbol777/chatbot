#!/usr/bin/env bash
set -Eeuo pipefail

PROJECT_PATH="${1:-/root/danoa/chatbot-main}"
ARCHIVE_PATH="${2:?archive path is required}"
LOCAL_MANIFEST_PATH="${3:?manifest path is required}"
TS="${4:?timestamp is required}"

BACKUP_ROOT="$PROJECT_PATH/.deploy-backups"
BACKUP_DIR="$BACKUP_ROOT/$TS"
STAGE_DIR="/tmp/danoa-deploy-$TS/stage"
REMOTE_MANIFEST_BEFORE="/tmp/danoa-deploy-$TS/remote-before.tsv"
REMOTE_MANIFEST_AFTER="/tmp/danoa-deploy-$TS/remote-after.tsv"

cd "$PROJECT_PATH"
mkdir -p "$BACKUP_DIR" "$STAGE_DIR"
chmod 700 "$BACKUP_ROOT" "$BACKUP_DIR"

manifest() {
  find . -type f \
    ! -path './.git/*' \
    ! -path './.deploy/*' \
    ! -path './.deploy-backups/*' \
    ! -path './.kilo/*' \
    ! -path './.vscode/*' \
    ! -path './node_modules/*' \
    ! -path '*/node_modules/*' \
    ! -path './data/*' \
    ! -path './logs/*' \
    ! -path './uploads/*' \
    ! -path './testimage/*' \
    ! -path './VM/*' \
    ! -path './uptime/*' \
    ! -path './frontend/dist/*' \
    ! -path './frontend/frontend/*' \
    ! -path './backend/storage/*' \
    ! -path './backend/uploads/*' \
    ! -path './backend/testimage/*' \
    ! -path './backend/data/*' \
    ! -path './deploy/.env.production' \
    ! -path './.env' \
    ! -path './.env.*' \
    ! -path './backend/admin.json' \
    ! -path './backend/audit.log' \
    ! -path './backend/data.json' \
    ! -path './backend/dev.db' \
    ! -path './backend/subscriptions.json' \
    ! -name '*.log' \
    ! -name '*.tmp' \
    ! -name '*.pid' \
    ! -name '*.tsbuildinfo' \
    -print0 | sort -z | while IFS= read -r -d '' file; do
      rel="${file#./}"
      size="$(stat -c %s "$file")"
      hash="$(sha256sum "$file" | awk '{print $1}')"
      printf '%s\t%s\t%s\n' "$rel" "$size" "$hash"
    done
}

manifest > "$REMOTE_MANIFEST_BEFORE"
tar -czf "$BACKUP_DIR/code-before.tar.gz" \
  --exclude='./.git' \
  --exclude='./.deploy' \
  --exclude='./.deploy-backups' \
  --exclude='./node_modules' \
  --exclude='./*/node_modules' \
  --exclude='./data' \
  --exclude='./logs' \
  --exclude='./uploads' \
  --exclude='./testimage' \
  --exclude='./VM' \
  --exclude='./uptime' \
  --exclude='./frontend/dist' \
  --exclude='./backend/storage' \
  --exclude='./backend/uploads' \
  --exclude='./backend/testimage' \
  --exclude='./backend/data' \
  --exclude='./.env' \
  --exclude='./.env.*' \
  .

if [ -f .env ]; then
  cp -p .env "$BACKUP_DIR/env.before"
  chmod 600 "$BACKUP_DIR/env.before"
fi

if docker compose ps mysql >/dev/null 2>&1; then
  docker compose exec -T mysql mariadb-dump -uroot chatbot > "$BACKUP_DIR/chatbot-db-before.sql"
  chmod 600 "$BACKUP_DIR/chatbot-db-before.sql"
fi

tar -xzf "$ARCHIVE_PATH" -C "$STAGE_DIR"

cut -f2 "$LOCAL_MANIFEST_PATH" | sort > "/tmp/danoa-deploy-$TS/local-files.txt"
cut -f2 "$REMOTE_MANIFEST_BEFORE" | sort > "/tmp/danoa-deploy-$TS/remote-files.txt"
comm -23 "/tmp/danoa-deploy-$TS/remote-files.txt" "/tmp/danoa-deploy-$TS/local-files.txt" > "/tmp/danoa-deploy-$TS/delete-files.txt"

while IFS= read -r rel; do
  [ -n "$rel" ] || continue
  case "$rel" in
    .git/*|.deploy/*|.deploy-backups/*|node_modules/*|*/node_modules/*|data/*|logs/*|uploads/*|testimage/*|VM/*|uptime/*|frontend/dist/*|frontend/frontend/*|backend/storage/*|backend/uploads/*|backend/testimage/*|backend/data/*|.env|.env.*|deploy/.env.production)
      echo "refusing excluded delete: $rel" >&2
      exit 10
      ;;
  esac
  rm -f -- "$rel"
done < "/tmp/danoa-deploy-$TS/delete-files.txt"

cp -a "$STAGE_DIR/." "$PROJECT_PATH/"

manifest > "$REMOTE_MANIFEST_AFTER"
if ! diff -u "$LOCAL_MANIFEST_PATH" "$REMOTE_MANIFEST_AFTER" > "$BACKUP_DIR/manifest-diff-after.txt"; then
  echo "manifest_mismatch"
  exit 20
fi

echo "backup_dir=$BACKUP_DIR"
echo "deleted_count=$(wc -l < "/tmp/danoa-deploy-$TS/delete-files.txt")"
echo "manifest_count=$(wc -l < "$REMOTE_MANIFEST_AFTER")"
