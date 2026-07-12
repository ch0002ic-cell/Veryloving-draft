FROM node:22-alpine

WORKDIR /app
COPY server/clm-server.cjs server/safety-companion.cjs ./

ENV NODE_ENV=production
ENV PORT=8787
EXPOSE 8787

USER node
HEALTHCHECK --interval=30s --timeout=3s --start-period=10s --retries=3 \
  CMD wget -q -O - "http://127.0.0.1:${PORT}/health" >/dev/null || exit 1

CMD ["node", "clm-server.cjs"]
