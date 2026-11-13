# Nodex server (opt-in) - stores diagrams and serves the MCP toolkit.
# Build from the repo root: docker build -f server/Dockerfile .
FROM node:24-alpine

WORKDIR /app

# Runtime dependencies only (the editor's libraries are dev dependencies -
# Vite bundles them into the web image)
COPY package*.json ./
RUN npm ci --omit=dev && npm cache clean --force

# The toolkit reuses the editor's pure modules (analysis, links, icon ids)
COPY server ./server
COPY src/analysis.js src/links.js ./src/
COPY src/three/modelIds.js ./src/three/

ENV HOST=0.0.0.0 \
    PORT=7071 \
    NODEX_DATA=/data
RUN mkdir -p /data && chown node:node /data
VOLUME /data
EXPOSE 7071
USER node

CMD ["node", "server/server.js"]
