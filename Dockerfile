FROM node:24-bookworm-slim AS build
WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1
COPY package.json package-lock.json ./
RUN npm ci
COPY tsconfig.json next.config.ts postcss.config.mjs components.json ./
COPY src ./src
RUN npm run build

FROM node:24-bookworm-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production NEXT_TELEMETRY_DISABLED=1 HOSTNAME=0.0.0.0 PORT=3000 \
    PYTHON_BIN=/opt/font-tools/bin/python3 FONT_DATA_DIR=/app/data/fonts FONT_CACHE_DIR=/app/data/cache
RUN apt-get update && apt-get install -y --no-install-recommends python3 python3-venv \
    && rm -rf /var/lib/apt/lists/* \
    && python3 -m venv /opt/font-tools
COPY requirements.txt ./
RUN /opt/font-tools/bin/pip install --no-cache-dir -r requirements.txt \
    && SP=/opt/font-tools/lib/python3.11/site-packages \
    && rm -rf $SP/pip $SP/pip-* $SP/setuptools $SP/setuptools-* $SP/pkg_resources \
       $SP/_distutils_hack $SP/distutils-precedence.pth $SP/*.dist-info
COPY --from=build --chown=node:node /app/.next/standalone ./
COPY --from=build --chown=node:node /app/.next/static ./.next/static
COPY --chown=node:node scripts ./scripts
COPY --chown=node:node fonts/catalog.json ./fonts/catalog.json
# Clip data ships inside the image; mounting a newer file still wins.
COPY --chown=node:node data/videos.json ./data/videos.json
COPY --chmod=755 docker-entrypoint.sh /usr/local/bin/linxie-entrypoint.sh
RUN mkdir -p data/fonts data/cache && chown -R node:node data .next && command -v setpriv
USER root
ENTRYPOINT ["/usr/local/bin/linxie-entrypoint.sh"]
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=30s --retries=3 \
    CMD node -e "fetch('http://127.0.0.1:3000/api/health').then(r=>{if(!r.ok)process.exit(1)}).catch(()=>process.exit(1))"
CMD ["node", "server.js"]
