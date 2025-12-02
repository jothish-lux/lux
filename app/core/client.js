const {
  default: makeWASocket,
  fetchLatestBaileysVersion,
  useMultiFileAuthState
} = require('@adiwajshing/baileys');

const pino = require('pino');
const path = require('path');

const logger = pino({ level: process.env.LOG_LEVEL || 'info' });

async function createClient() {
  const { state, saveCreds } = await useMultiFileAuthState(
    path.join(__dirname, 'auth')
  );

  const { version } = await fetchLatestBaileysVersion();

  const sock = makeWASocket({
    auth: state,
    logger,
    printQRInTerminal: true,     // <-- SHOWS Q R CODE
    version,
    browser: ['Lux', 'Chrome', '4.0.0'],
  });

  sock.ev.on('creds.update', saveCreds);

  return sock;
}

module.exports = { createClient };
