/*
 core/session.js — robust: normalize auth helpers, ensure state, and print QR to terminal
*/

const fs = require('fs');
const path = require('path');
const pino = require('pino');
const qrcode = require('qrcode-terminal');
const logger = pino({ level: process.env.DEBUG ? 'debug' : 'info' });

let makeWASocket;
let useSingleFileAuthState;

function tryRequire(name) {
  try { return require(name); } catch (e) { return null; }
}

// try common packages
const pkg = tryRequire('@whiskeysockets/baileys') || tryRequire('@adiwajshing/baileys') || tryRequire('baileys');

if (pkg) {
  makeWASocket = pkg.default || pkg.makeWASocket || pkg;
  useSingleFileAuthState = pkg.useSingleFileAuthState || pkg.useMultiFileAuthState || undefined;
}

// tiny single-file auth fallback
function simpleFileAuthState(filePath) {
  const resolved = path.resolve(filePath);
  let state = {};
  try {
    if (fs.existsSync(resolved)) {
      const raw = fs.readFileSync(resolved, 'utf8');
      state = raw ? JSON.parse(raw) : {};
      logger.info({ file: resolved }, 'Loaded auth state from file (fallback).');
    } else {
      state = {};
    }
  } catch (e) {
    logger.warn({ err: e.message }, 'Failed to read session file, starting with empty auth state.');
    state = {};
  }

  function saveState() {
    try {
      fs.writeFileSync(resolved, JSON.stringify(state, null, 2));
      logger.info({ file: resolved }, 'Saved auth state to file (fallback).');
    } catch (e) {
      logger.error({ err: e.message }, 'Failed to write session file.');
    }
  }

  state = state || {};
  state.creds = state.creds || {};
  state.keys = state.keys || {};

  return {
    state,
    saveState,
    _merge(newState) {
      for (const k of Object.keys(newState || {})) state[k] = newState[k];
      saveState();
    },
  };
}

if (!makeWASocket) {
  logger.error('Could not locate a Baileys package. Install one of: @whiskeysockets/baileys or @adiwajshing/baileys');
  throw new Error('Baileys is missing');
}

/**
 * Normalize whatever useSingleFileAuthState returns into { state, saveState, _merge? }
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
          } catch (e) {}
        },
      };
    }
  }

  return simpleFileAuthState(sessionFile);
}

function startSession({ sessionFile = './session.json', printQRInTerminal = true, browserName = ['lux-bot', 'Chrome', '1.0'] } = {}) {
  let authHelpersRaw;
  if (typeof useSingleFileAuthState === 'function') {
    try {
      authHelpersRaw = useSingleFileAuthState(sessionFile);
      logger.info('Using useSingleFileAuthState from Baileys package.');
    } catch (e) {
      logger.warn({ err: e.message }, 'useSingleFileAuthState exists but threw — falling back to simpleFileAuthState.');
      authHelpersRaw = null;
    }
  } else {
    logger.info('useSingleFileAuthState not found; using simpleFileAuthState fallback.');
    authHelpersRaw = null;
  }

  const authHelpers = normalizeAuthHelpers(authHelpersRaw, sessionFile);
  const { state, saveState } = authHelpers;

  state.creds = state.creds || {};
  state.keys = state.keys || {};

  const sock = makeWASocket({
    logger,
    printQRInTerminal,
    auth: state,
    browser: browserName,
  });

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
        logger.error({ err: e.message }, 'Error handling creds.update');
      }
    });

    sock.ev.on('connection.update', (update) => {
      const { connection, lastDisconnect, qr } = update;
      logger.info({ connection }, 'connection.update');

      if (qr) {
        console.log('\\n=== SCAN QR BELOW (WhatsApp → Settings → Linked devices → Link a device) ===\\n');
        qrcode.generate(qr, { small: true });
        console.log('\\n=== END QR ===\\n');
      }

      if (connection === 'close') {
        const statusCode = lastDisconnect?.error?.output?.statusCode;
        const shouldReconnect = statusCode !== 401;
        if (shouldReconnect) {
          logger.info('Connection closed unexpectedly. Baileys may attempt reconnect automatically.');
        } else {
          logger.warn('Session logged out (401). Remove session file and re-authenticate.');
        }
      } else if (connection === 'open') {
        logger.info('Connected to WhatsApp.');
      }
    });
  } else {
    logger.warn('Socket event emitter not as expected; connection updates may not be handled.');
  }

  return sock;
}

module.exports = { startSession };
