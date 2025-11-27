# Dockerfile for Lux WhatsApp bot (Fly-friendly)
FROM node:20-alpine

# Set working dir
WORKDIR /app

# Ensure a predictable install environment
ENV NODE_ENV=production
ENV NPM_CONFIG_LOGLEVEL=warn

# Install app dependencies (use package-lock if present)
COPY package.json package-lock.json* ./
RUN npm ci --production

# Copy the rest of the app into the image
COPY . .

# Make the start script executable
RUN if [ -f /app/core/start.sh ]; then chmod +x /app/core/start.sh; fi

# Prepare folders used for persistence and ensure image has a copy of db code
# (This gives the start.sh something to copy into the mounted volume on first run)
RUN mkdir -p /data/auth /data/db \
 && mkdir -p /app/db /app/core/auth \
 && cp -R /app/db/* /data/db/ 2>/dev/null || true

# Ensure symlinks are in place in the image (they will be re-created by start.sh at runtime if needed)
RUN rm -rf /app/core/auth /app/db 2>/dev/null || true \
 && ln -s /data/auth /app/core/auth \
 && ln -s /data/db /app/db || true

# Expose no ports (bot does not serve HTTP)
# VOLUME is managed by Fly; don't declare here

# Use start script which:
# - ensures /data has required files
# - copies db files into volume on first run (if missing)
# - creates symlinks
# - starts node
CMD ["/app/core/start.sh"]
