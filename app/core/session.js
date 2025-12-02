// core/session.js
// Robust Baileys session bootstrap with QR terminal + pairing-code support.
// Drop into core/session.js and restart your bot (npm start).
//
// Notes to user:
// - If you run locally: scan the ASCII QR with WhatsApp -> Settings -> Linked devices -> Link a device
// - If you run on a VPS and pairing is required: follow pairing code instructions printed in the terminal
//
// Recommended: keep a backup of any existing session.json before overwriting.

const fs = require('fs');
const path = require('path');
const pino = require('pino');
const qrcode = require('qrcode-terminal');

const logger = pino({ level: process.env.DEBUG ? 'debug' : 'info' });

// Try to require a Baileys package (whiskeysockets fork preferred, but original supported)
function tryRequire(name) {
  try {
    return require(name);
  } catch (e) {
    return null;
  }
}

const pkg = tryRequire('@whiskeysockets/baileys') || tryRequire('@adiwajshing/baileys') || tryRequire('baileys');

if (!pkg) {
  logger.error('No Baileys package found. Install @whiskeysockets/baileys or @adiwajshing/baileys.');
  throw new Error('Baileys package missing');
}

const makeWASocket = pkg.default || pkg.makeWASocket || pkg;
const useSingleFileAuthState = pkg.useSingleFileAuthState || pkg.useMultiFileAuthState || undefined;

/* simple file-based fallback auth helper (ensures state.creds & state.keys exist)
   This is only used when Baileys helper is unavailable or throws.
*/
function simpleFileAuthState(filePath) {
  const resolved = path.resolve(filePath);
  let state = {};
  try {
    if (fs.existsSync(resolved) && fs.statSync(resolved).isFile()) {
      const raw = fs.readFileSync(resolved, 'utf8');
      state = raw ? JSON.parse(raw) : {};
      logger.info({ file: resolved }, 'Loaded auth state from file (fallback)');
    } else {
      state = {};
    }
  } catch (e) {
    logger.warn({ err: e.message }, 'Failed to read session file, starting with empty auth state (fallback)');
    state = {};
  }

  // ensure minimal structure Baileys expects
  state = state || {};
  state.creds = state.creds || {};
  state.keys = state.keys || {};

  function saveState() {
    try {
      fs.writeFileSync(resolved, JSON.stringify(state, null, 2));
      logger.info({ file: resolved }, 'Saved auth state to file (fallback)');
    } catch (e) {
      logger.error({ err: e.message }, 'Failed to write session file (fallback)');
    }
  }

  return {
    state,
    saveState,
    _merge(newState) {
      for (const k of Object.keys(newState || {})) state[k] = newState[k];
      saveState();
    },
  };
}

/**
 * Normalize different shapes returned by useSingleFileAuthState (array or object)
 */
function normalizeAuthHelpers(helperResult, sessionFile) {
  if (!helperResult) return simpleFileAuthState(sessionFile);

  if (Array.isArray(helperResult)) {
    const [stateRaw, saveFn] = helperResult;
    const state = stateRaw || {};
    state.creds = state.creds || {};
    state.keys = state.keys || {};
    return {
      state,
      saveState: typeof saveFn === 'function' ? saveFn : () => {},
      _merge(newState) {
        if (newState && typeof newState === 'object') {
          for (const k of Object.keys(newState)) state[k] = newState[k];
          if (typeof saveFn === 'function') saveFn();
        }
      },
    };
  }

  if (typeof helperResult === 'object') {
    if ('state' in helperResult && 'saveState' in helperResult) {
      const state = helperResult.state || {};
      state.creds = state.creds || {};
      state.keys = state.keys || {};
      const saveStateFn = typeof helperResult.saveState === 'function' ? helperResult.saveState : () => {};
      return {
        state,
        saveState: saveStateFn,
        _merge: typeof helperResult._merge === 'function' ? helperResult._merge : (ns) => {
          try {
            for (const k of Object.keys(ns || {})) helperResult.state[k] = ns[k];
            if (typeof saveStateFn === 'function') saveStateFn();
          } catch (e) { /* ignore */ }
        },
      };
    }
  }

  return simpleFileAuthState(sessionFile);
}

/**
 * startSession
 * - sessionFile: path to JSON file used for auth persistence (default ./session.json)
 * - preferPairing: boolean (if true, attempt pairing-code flow when supported by the socket)
 */
async function startSession({ sessionFile = './session.json', preferPairing = true, browserName = ['lux-bot', 'Chrome', '1.0'] } = {}) {
  // obtain auth helpers
  let authHelpersRaw = null;
  if (typeof useSingleFileAuthState === 'function') {
    try {
      // Some Baileys helpers return { state, saveState } or [state, saveState]
      authHelpersRaw = useSingleFileAuthState(sessionFile);
      logger.info('Attempted to use Baileys useSingleFileAuthState helper.');
    } catch (e) {
      logger.warn({ err: e.message }, 'Baileys auth helper threw; falling back to simple file auth.');
      authHelpersRaw = null;
    }
  } else {
    logger.info('Baileys auth helper not found; using fallback file auth.');
  }

  const authHelpers = normalizeAuthHelpers(authHelpersRaw, sessionFile);
  const { state, saveState } = authHelpers;

  // Ensure minimal structure so Baileys will not crash
  state.creds = state.creds || {};
  state.keys = state.keys || {};

  // create the socket
  // We set printQRInTerminal false because many Baileys versions deprecate it;
  // instead we listen for update.qr and print with qrcode-terminal (works in Codespaces/terminals)
  const sock = makeWASocket({
    logger,
    printQRInTerminal: false,
    auth: state,
    browser: browserName,
    // many builds accept usePairingCode; harmless if ignored by some builds
    usePairingCode: preferPairing,
  });

  // Persist creds updates using whichever method is available
  if (sock && sock.ev && typeof sock.ev.on === 'function') {
    sock.ev.on('creds.update', (update) => {
      try {
        if (typeof authHelpers._merge === 'function') {
          authHelpers._merge({ creds: update });
        } else if (typeof saveState === 'function') {
          state.creds = update;
          saveState();
        } else {
          logger.warn('No method available to persist creds.update.');
        }
      } catch (e) {
        logger.error({ err: e.message }, 'Error while handling creds.update');
      }
    });

    // connection updates: print QR when provided, show pairing code if available, log state
    sock.ev.on('connection.update', async (update) => {
      try {
        const { connection, lastDisconnect, qr, pairing } = update || {};
        logger.info({ connection }, 'connection.update');

        // If a QR string is emitted, print a terminal-friendly QR
        if (qr) {
          // print big instruction and QR ASCII
          console.log('\n=== SCAN QR BELOW (WhatsApp → Settings → Linked devices → Link a device) ===\n');
          try {
            qrcode.generate(qr, { small: true });
          } catch (e) {
            // fallback: print raw QR string
            console.log(qr);
          }
          console.log('\n=== END QR ===\n');
        }

        // Some Baileys builds may include 'pairing' info in the update;
        // also some sockets expose requestPairingCode or generatePairingCode
        // We'll attempt to request a pairing code if pairing is supported and preferPairing is true.
        if (preferPairing) {
          // If update contains pairing info, display it
          if (pairing) {
            try {
              console.log('\n=== PAIRING INFO ===');
              console.log(JSON.stringify(pairing, null, 2));
              console.log('=== END PAIRING INFO ===\n');
            } catch (e) { /* ignore formatting errors */ }
          }

          // If socket supports requestPairingCode, try calling it
          try {
            if (typeof sock.requestPairingCode === 'function') {
              // attempt to request a pairing code; many implementations accept optionally a phone number
              const res = await sock.requestPairingCode();
              // res may be string or object { code, expiresAt } depending on build
              const code = res && (res.code || res.pairingCode || res);
              if (code) {
                console.log(`\n=== PAIRING CODE ===\n${String(code)}\n=== END PAIRING CODE ===`);
                console.log('On your phone: WhatsApp → Settings → Linked devices → Link with phone number (enter pairing code).');
              }
            } else if (typeof sock.generatePairingCode === 'function') {
              const res2 = await sock.generatePairingCode();
              const code = res2 && (res2.code || res2.pairingCode || res2);
              if (code) {
                console.log(`\n=== PAIRING CODE ===\n${String(code)}\n=== END PAIRING CODE ===`);
                console.log('On your phone: WhatsApp → Settings → Linked devices → Link with phone number (enter pairing code).');
              }
            }
          } catch (e) {
            // non-fatal — pairing may not be supported by this build
            logger.debug({ err: e && e.message }, 'requestPairingCode/generatePairingCode threw (non-fatal)');
          }
        }

        // handle connection close / reconnect
        if (connection === 'close') {
          const statusCode = lastDisconnect?.error?.output?.statusCode;
          const shouldReconnect = statusCode !== 401;
          if (shouldReconnect) {
            logger.info('Connection closed unexpectedly. Baileys may attempt reconnect automatically.');
          } else {
            logger.warn('Session logged out (401). Remove session.json and re-authenticate.');
          }
        } else if (connection === 'open') {
          logger.info('Connected to WhatsApp.');
        }
      } catch (e) {
        logger.error({ err: e && e.message }, 'Error in connection.update handler');
      }
    });
  } else {
    logger.warn('Socket event emitter not as expected; connection updates may not be handled.');
  }

  // return the socket so caller can attach handlers
  return sock;
}

module.exports = { startSession };
