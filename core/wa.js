// core/wa.js
// Creates a Baileys socket and persists auth state to Postgres via db/sessions.js

const makeWASocket = require('@adiwajshing/baileys').default || require('@adiwajshing/baileys');
const { getSession, upsertSession } = require('../db/sessions');
const logger = console;

const SESSION_ID = process.env.SESSION_ID || 'lux_main';

async function startSock({ printQRInTerminal = true } = {}) {
  // load saved session from DB (if any)
  let saved = null;
  try {
    saved = await getSession(SESSION_ID);
    if (saved) logger.info(`Loaded session ${SESSION_ID} from DB`);
  } catch (e) {
    logger.warn('Failed to load session from DB', e);
  }

  // Baileys expects an auth object with { creds, keys } (or similar).
  // We will pass whatever was stored (or an empty object) and then save updates.
  let auth = saved || { creds: {}, keys: {} };

  // Create socket
  const sock = makeWASocket({
    printQRInTerminal,
    auth, // pass previously loaded auth state
    // you can add logger, browser etc here
    getMessage: async () => ({}) // stub (Baileys callback)
  });

  // Listen for credentials updates and persist them
  try {
    sock.ev.on('creds.update', async (creds) => {
      // creds is usually a partial; combine with existing state
      try {
        // Construct a persisted authState object from current socket internals if available
        // Different Baileys versions expose state differently. We try a few fallbacks.
        let authStateToSave = null;

        if (sock.authState) {
          authStateToSave = sock.authState;
        } else {
          // fallback: build object from sock.state or from sock.auth
          authStateToSave = {
            creds: (sock.state && sock.state.creds) || (sock.auth && sock.auth.creds) || {},
            keys: (sock.state && sock.state.keys) || (sock.auth && sock.auth.keys) || {}
          };
        }

        await upsertSession(SESSION_ID, authStateToSave);
        logger.info('Saved session to DB (creds.update)');
      } catch (err) {
        logger.error('Failed to save session on creds.update', err);
      }
    });
  } catch (e) {
    logger.warn('creds.update handler may not be available on this Baileys version', e);
  }

  // General connection updates (open, close, QR)
  sock.ev.on('connection.update', async (update) => {
    try {
      const { connection, lastDisconnect, qr } = update;
      if (qr) {
        // also emit event so other parts (web SSE) can capture it
        sock.qr = qr; // store latest qr
      }
      if (connection === 'open') {
        logger.info('Baileys connection opened');
        // Save the final auth state to DB too
        try {
          let authStateToSave = sock.authState || { creds: (sock.state && sock.state.creds) || {}, keys: (sock.state && sock.state.keys) || {} };
          await upsertSession(SESSION_ID, authStateToSave);
          logger.info('Saved session to DB (connection.open)');
        } catch (err) {
          logger.error('Failed saving session on connection open', err);
        }
      } else if (connection === 'close') {
        logger.warn('Baileys connection closed', lastDisconnect?.error?.message || lastDisconnect);
      }
    } catch (err) {
      logger.error('Error in connection.update handler', err);
    }
  });

  return sock;
}

module.exports = { startSock };
