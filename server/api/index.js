'use strict';

const { URL } = require('node:url');
const { createHandler } = require('../clm-server.cjs');

const INTERNAL_ROUTE_PARAMETER = '__veryloving_route';
const MAX_ROUTE_LENGTH = 1024;
const MAX_ROUTE_SEGMENT_LENGTH = 128;
const handler = createHandler({ httpOnlyDeployment: true });

function isSafeRoute(route) {
  if (route.length > MAX_ROUTE_LENGTH) return false;
  if (route === '') return true;
  return route.split('/').every((segment) => (
    segment !== '.'
    && segment !== '..'
    && segment.length > 0
    && segment.length <= MAX_ROUTE_SEGMENT_LENGTH
    && /^[A-Za-z0-9._:~-]+$/.test(segment)
  ));
}

function badRewriteRequest(response) {
  const body = JSON.stringify({ error: 'Invalid internal route metadata' });
  response.writeHead(400, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(body),
    'Cache-Control': 'no-store'
  });
  response.end(body);
}

module.exports = function vercelHandler(request, response) {
  let rewrittenURL;
  try {
    rewrittenURL = new URL(request.url || '/', 'https://veryloving.invalid');
  } catch {
    badRewriteRequest(response);
    return;
  }

  const rewrittenRoutes = rewrittenURL.searchParams.getAll(INTERNAL_ROUTE_PARAMETER);
  if (rewrittenRoutes.length !== 1 || !isSafeRoute(rewrittenRoutes[0])) {
    badRewriteRequest(response);
    return;
  }

  const [rewrittenRoute] = rewrittenRoutes;
  rewrittenURL.searchParams.delete(INTERNAL_ROUTE_PARAMETER);
  const query = rewrittenURL.searchParams.toString();
  request.url = `/${rewrittenRoute}${query ? `?${query}` : ''}`;
  return handler(request, response);
};
