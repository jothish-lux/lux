# Dockerfile for Lux WhatsApp bot (Alpine)
FROM node:20-alpine

WORKDIR /app

ENV NODE_ENV=production
ENV NPM_CONFIG_LOGLEVEL=warn

COPY package.json package-lock.json* ./

# Install build/runtime deps then install node modules, then remove build deps
RUN apk add --no-cache \
    build-base \
    python3 \
    libtool \
    automake \
    autoconf \
    pkgconfig \
    jpeg-dev \
    libpng-dev \
    giflib-dev \
    lcms2-dev \
    vips-dev \
    libwebp-dev \
    fftw-dev \
    ffmpeg \
  && npm ci --production \
  && apk del build-base python3 automake autoconf libtool pkgconfig || true

COPY . .

RUN if [ -f /app/core/start.sh ]; then chmod +x /app/core/start.sh; fi

RUN mkdir -p /data/auth /data/db \
 && mkdir -p /app/db /app/core/auth \
 && cp -R /app/db/* /data/db/ 2>/dev/null || true

RUN rm -rf /app/core/auth /app/db 2>/dev/null || true \
 && ln -s /data/auth /app/core/auth \
 && ln -s /data/db /app/db || true

CMD ["/app/core/start.sh"]
