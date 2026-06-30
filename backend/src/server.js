//
// server.js — process entry point. Loads env, hydrates the store, starts HTTP.
//

require('dotenv').config();

const config = require('./config');
const store = require('./store');
const { createApp } = require('./app');

store.load();

const app = createApp();

const server = app.listen(config.port, () => {
  console.log('');
  console.log(`  Veryloving backend listening on http://localhost:${config.port}`);
  console.log(`  Health:   GET http://localhost:${config.port}/health`);
  console.log(`  Persist:  ${config.persist ? config.dataFile : 'off (in-memory only)'}`);
  if (config.jwtSecret === 'change_this') {
    console.warn('  ⚠️  JWT_SECRET is the default "change_this" — set a real secret in .env for anything real.');
  }
  console.log('');
});

// Graceful shutdown so `node --watch` / Ctrl-C don't leave a dangling port.
for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => {
    console.log(`\n${signal} received — shutting down.`);
    server.close(() => process.exit(0));
  });
}

module.exports = server;
