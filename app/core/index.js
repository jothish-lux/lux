// core/index.js (excerpt to integrate web + socket)
// ... at top of file
const express = require('express');
const getSessionRouter = require('../web/getSession');
const { startSock } = require('./wa');

async function main() {
  // start the main Baileys socket (loads session from DB)
  const sock = await startSock({ printQRInTerminal: true });
  // you probably have command loading here — keep it and pass sock to commands
  // --- your existing command loader code should use `sock` as before ---

  // start tiny express app for web + session UI
  const app = express();
  app.use('/', getSessionRouter);
  const port = process.env.WEB_PORT || 3000;
  app.listen(port, () => console.log(`Session web UI listening on :${port}`));
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
