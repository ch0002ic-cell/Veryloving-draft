//
// app.js — builds and wires the Express application (no listening here, so it
// can be imported by tests). Routes mirror docs/BACKEND_API.md, mounted under
// `/v1`, with `/auth` aliases for the Phase 4 brief.
//

const express = require('express');
const cors = require('cors');

const authRouter = require('./routes/auth');
const sosRouter = require('./routes/sos');
const contactsRouter = require('./routes/contacts');
const devicesRouter = require('./routes/devices');
const subscriptionRouter = require('./routes/subscription');
const analyticsRouter = require('./routes/analytics');

function createApp() {
  const app = express();
  app.disable('x-powered-by');

  app.use(cors());
  app.use(express.json({ limit: '1mb' }));

  // Concise access log.
  app.use((req, res, next) => {
    const start = Date.now();
    res.on('finish', () => {
      console.log(`${req.method} ${req.originalUrl} → ${res.statusCode} (${Date.now() - start}ms)`);
    });
    next();
  });

  // Health + root.
  app.get('/health', (req, res) => res.json({ status: 'ok' }));
  app.get('/', (req, res) =>
    res.json({ name: 'veryloving-backend', status: 'ok', docs: 'see ../docs/BACKEND_API.md' })
  );

  // Auth is reachable at both prefixes.
  app.use('/v1/auth', authRouter);
  app.use('/auth', authRouter);

  // Versioned feature routes.
  app.use('/v1/sos', sosRouter);
  app.use('/v1/contacts', contactsRouter);
  app.use('/v1/devices', devicesRouter);
  app.use('/v1/subscription', subscriptionRouter);
  app.use('/v1/analytics', analyticsRouter);

  // 404 — keep the { message } shape the client surfaces.
  app.use((req, res) => {
    res.status(404).json({ message: `No route for ${req.method} ${req.path}` });
  });

  // Centralised error handler. Malformed JSON bodies land here as 400.
  // eslint-disable-next-line no-unused-vars
  app.use((err, req, res, next) => {
    if (err.type === 'entity.parse.failed') {
      return res.status(400).json({ message: 'Request body was not valid JSON.' });
    }
    console.error('[error]', err);
    res.status(500).json({ message: 'Something went wrong on our end. Please try again.' });
  });

  return app;
}

module.exports = { createApp };
