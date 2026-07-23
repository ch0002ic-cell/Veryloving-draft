FROM node:24.18.0-alpine3.24@sha256:a0b9bf06e4e6193cf7a0f58816cc935ff8c2a908f81e6f1a95432d679c54fbfd AS build

WORKDIR /app/server
COPY server/package.json server/package-lock.json ./
RUN npm install --global npm@12.0.1 --ignore-scripts --no-audit --no-fund
RUN npm ci --ignore-scripts
COPY server/tsconfig.adapters.json ./
COPY server/tsconfig.ai-native.json ./
COPY server/src ./src
RUN npm run build

FROM node:24.18.0-alpine3.24@sha256:a0b9bf06e4e6193cf7a0f58816cc935ff8c2a908f81e6f1a95432d679c54fbfd

WORKDIR /app
COPY server/package.json server/package-lock.json ./
RUN npm install --global npm@12.0.1 --ignore-scripts --no-audit --no-fund
RUN npm ci --omit=dev --ignore-scripts \
  && npm cache clean --force \
  && rm -rf /usr/local/lib/node_modules/npm \
  && rm -f /usr/local/bin/npm /usr/local/bin/npx
COPY server/*.cjs ./
COPY --from=build /app/server/dist ./dist
COPY --from=build /app/server/dist-ai-native ./dist-ai-native

ENV NODE_ENV=production
ENV PORT=8787
EXPOSE 8787

USER node
HEALTHCHECK --interval=30s --timeout=3s --start-period=10s --retries=3 \
  CMD wget -q -O - "http://127.0.0.1:${PORT}/health" >/dev/null || exit 1

CMD ["node", "clm-server.cjs"]
