// index.js
const { startSession } = require('./core/session');
const { init } = require('./core/handler');
const JsonDB = require('./db/json');
const config = require('./config');

async function main() {
  const client = startSession({ sessionFile: config.SESSION_FILE, printQRInTerminal: true });
  const db = new JsonDB(); // default path ./data/db.json

  // give a little time for Baileys to initialize events
  setTimeout(() => {
    init({ client, db, config });
    console.log('Handler initialized. Bot ready.');
  }, 1000);

  // clean shutdown on SIGINT/SIGTERM
  process.on('SIGINT', () => {
    console.log('SIGINT received, exiting.');
    process.exit(0);
  });
  process.on('SIGTERM', () => {
    console.log('SIGTERM received, exiting.');
    process.exit(0);
  });
}

main().catch((e) => {
  console.error('Fatal error on startup', e);
  process.exit(1);
});
