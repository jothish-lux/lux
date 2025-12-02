#!/usr/bin/env bash
set -euo pipefail

APP_DIR="/app"
DATA_DIR="/data"
AUTH_DATA_DIR="${DATA_DIR}/auth"
DB_DATA_DIR="${DATA_DIR}/db"
APP_DB_DIR="${APP_DIR}/db"
APP_CORE_AUTH_DIR="${APP_DIR}/core/auth"
STARTUP_SCRIPT="${APP_DIR}/core/start.sh"

# env-configurable
AUTH_FILE_ENV="${AUTH_FILE:-./auth.json}"   # used by bootstrap script if present
BOOTSTRAP_SCRIPT="${BOOTSTRAP_SCRIPT:-./bootstrap-auth.js}" # relative path inside app
SESSION_MODE="${MODE:-bot}"   # set MODE=session-generator to run session server
NODE_CMD="${NODE_CMD:-node index.js}"
SESSION_SERVER_CMD="${SESSION_SERVER_CMD:-node session-server.js}"

log() { printf '%s %s\n' "$(date --iso-8601=seconds 2>/dev/null || date)" "$*" ; }

log "start.sh: booting (MODE=${SESSION_MODE})"
log "Ensuring data directories exist..."

mkdir -p "${AUTH_DATA_DIR}" "${DB_DATA_DIR}"
chown -R node:node "${DATA_DIR}" 2>/dev/null || true

# seed DB files on first run if present in image
if [ -d "${APP_DB_DIR}" ] && [ -z "$(ls -A ${DB_DATA_DIR} 2>/dev/null)" ]; then
  log "Seeding /data/db from image /app/db"
  cp -R "${APP_DB_DIR}/." "${DB_DATA_DIR}/" 2>/dev/null || true
fi

# ensure core/auth template copy (if exists)
if [ -d "${APP_CORE_AUTH_DIR}" ] && [ -z "$(ls -A ${AUTH_DATA_DIR} 2>/dev/null)" ]; then
  log "Seeding /data/auth from /app/core/auth"
  cp -R "${APP_CORE_AUTH_DIR}/." "${AUTH_DATA_DIR}/" 2>/dev/null || true
fi

# recreate symlinks expected by your app
log "Creating symlinks /app/core/auth -> /data/auth and /app/db -> /data/db"
rm -rf "${APP_DIR}/core/auth" 2>/dev/null || true
rm -rf "${APP_DIR}/db" 2>/dev/null || true
ln -s "${AUTH_DATA_DIR}" "${APP_DIR}/core/auth" || true
ln -s "${DB_DATA_DIR}" "${APP_DIR}/db" || true

# If bootstrap script configured and auth not present, run it
if [ -f "${BOOTSTRAP_SCRIPT}" ]; then
  if [ ! -f "${AUTH_FILE_ENV}" ] && [ -z "$(ls -A ${AUTH_DATA_DIR} 2>/dev/null)" ]; then
    log "Running bootstrap script to fetch auth (if configured): ${BOOTSTRAP_SCRIPT}"
    # run as node; if it fails, we fail fast so container logs show error
    node "${BOOTSTRAP_SCRIPT}" || {
      log "bootstrap-auth failed — continuing, container may still start (auth missing)"
    }
  else
    log "auth present — skipping bootstrap"
  fi
else
  log "No bootstrap script found at ${BOOTSTRAP_SCRIPT} — skipping fetch"
fi

# If MODE=session-generator run session server instead of bot
if [ "${SESSION_MODE}" = "session-generator" ] || [ "${SESSION_MODE}" = "generator" ]; then
  log "Running session-generator mode: ${SESSION_SERVER_CMD}"
  exec ${SESSION_SERVER_CMD}
fi

# Final start of the bot
log "Starting bot: ${NODE_CMD}"
# Use exec so PID 1 becomes node process
exec ${NODE_CMD}
