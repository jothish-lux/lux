#!/bin/sh
set -e

# Ensure /data subfolders exist
mkdir -p /data/auth /data/db

# If db module files missing on the volume, copy the repo's db folder into the volume
if [ ! -f /data/db/db.js ]; then
  echo "Populating /data/db from image copy..."
  cp -R /app/db/* /data/db/ || true
fi

# If auth dir is empty, keep it (Baileys will write on first login)
chmod -R 755 /data || true

# Make symlinks (remove old ones if present)
rm -rf /app/core/auth /app/db || true
ln -s /data/auth /app/core/auth
ln -s /data/db /app/db

# Start the node app
exec node core/index.js
