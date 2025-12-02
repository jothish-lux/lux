// index.js - ES module
import fs from 'fs';
import path from 'path';
import qrcode from 'qrcode-terminal';
import sharp from 'sharp';

// dynamic import of baileys so we can gracefully handle different exports
const baileys = await import('@whiskeysockets/baileys').catch((e) => {
  console.error('Failed to import @whiskeysockets/baileys:', e.message || e);
  process.exit(1);
});

const {
  makeWASocket,
  fetchLatestBaileysVersion,
  delay,
  downloadContentFromMessage,
  jidNormalizedUser,
} = baileys;

// Prefer useSingleFileAuthState, fallback to useMultiFileAuthState
const useSingleFileAuthState = baileys.useSingleFileAuthState ?? null;
const useMultiFileAuthState = baileys.useMultiFileAuthState ?? null;

if (!useSingleFileAuthState && !useMultiFileAuthState) {
  console.error(`This version of @whiskeysockets/baileys doesn't export useSingleFileAuthState or useMultiFileAuthState.
Please install a compatible baileys version (e.g. ^6.7.x) or update this code to match your baileys export names.`);
  process.exit(1);
}

// choose a path for auth files
const AUTH_FILE = './auth_info.json';
let auth;
if (useSingleFileAuthState) {
  // use single file state (returns { state, saveCreds })
  auth = useSingleFileAuthState(AUTH_FILE);
} else {
  // useMultiFileAuthState returns { state, saveCreds } too, but may accept a folder
  // create folder if not exists
  const multiPath = path.join('.', 'auth_info_multi');
  if (!fs.existsSync(multiPath)) fs.mkdirSync(multiPath, { recursive: true });
  auth = await useMultiFileAuthState(multiPath);
}

const ALLOW_SELF = Boolean(process.env.ALLOW_SELF_COMMANDS);

function logger(...args) {
  // minimal logger - print timestamp
  console.log(new Date().toISOString(), ...args);
}

// helper: stream -> buffer
async function bufferFromStream(stream) {
  const chunks = [];
  for await (const chunk of stream) chunks.push(chunk);
  return Buffer.concat(chunks);
}

async function startSock() {
  // get latest version (best effort)
  let version = [2, 3000, 1027934701];
  try {
    const v = await fetchLatestBaileysVersion();
    if (Array.isArray(v)) version = v;
    logger('fetched baileys version', version);
  } catch (e) {
    logger('could not fetch latest baileys version, using default', e?.message ?? e);
  }

  const sock = makeWASocket({
    printQRInTerminal: false, // we'll show QR ourselves
    auth: auth.state,
    version,
    connectTimeoutMs: 60_000,
  });

  sock.ev.on('connection.update', (update) => {
    // update can contain: qr, connection, isOnline, lastDisconnect
    if (update.qr) {
      logger('QR received — printing to terminal');
      qrcode.generate(update.qr, { small: true });
    }
    if (update.connection) {
      logger('connection.update', update.connection, update.lastDisconnect ? update.lastDisconnect?.error ?? update.lastDisconnect : '');
    }
    if (update.isNewLogin) {
      logger('isNewLogin', update.isNewLogin);
    }
    if (update.isOnline !== undefined) {
      logger('isOnline', update.isOnline);
    }
  });

  // save creds on change
  sock.ev.on('creds.update', auth.saveCreds);

  // log low-level errors
  sock.ev.on('connection.error', (err) => {
    logger('connection.error', err);
  });

  // handle incoming messages
  sock.ev.on('messages.upsert', async (m) => {
    try {
      const upsertType = m.type; // 'notify', etc
      for (const msg of m.messages) {
        if (!msg.message) continue;

        // skip status broadcast messages
        if (msg.key && msg.key.remoteJid && msg.key.remoteJid.endsWith('@status.v.whatsapp.net')) continue;

        const from = msg.key.remoteJid;
        const isFromMe = !!msg.key.fromMe;
        // Respect ALLOW_SELF_COMMANDS env var
        if (!ALLOW_SELF && isFromMe) {
          // ignoring own messages
          continue;
        }

        // normalize jid for logs
        const jid = jidNormalizedUser(from);

        // pull text: conversation, extendedTextMessage, buttonsResponseMessage, listResponseMessage, etc.
        const message = msg.message;
        let text = '';
        if (message.conversation) text = message.conversation;
        else if (message.extendedTextMessage?.text) text = message.extendedTextMessage.text;
        else if (message.imageMessage?.caption) text = message.imageMessage.caption;
        else if (message.documentMessage?.caption) text = message.documentMessage.caption;
        else if (message.buttonsResponseMessage?.selectedDisplayText) text = message.buttonsResponseMessage.selectedDisplayText;
        else if (message.listResponseMessage?.singleSelectReply?.selectedDisplayText) text = message.listResponseMessage.singleSelectReply.selectedDisplayText;

        text = (text || '').trim();
        if (!text) {
          // We may still want to handle sticker creation if user sends captionless image + command as separate message.
          // But here we ignore empty textual messages.
        }

        // very simple command parse: starts with a dot `.cmd`
        const isCmd = text.startsWith('.');
        if (!isCmd) continue;

        const parts = text.slice(1).split(/\s+/);
        const cmd = parts.shift().toLowerCase();
        const args = parts;

        logger(`cmd=${cmd} args=${JSON.stringify(args)} from=${jid} fromMe=${isFromMe}`);

        // create a quoted wrapper to reply (use message.id when available)
        const quoted = msg.key && msg.key.id ? { quoted: msg } : {};

        // ---------- PING ----------
        if (cmd === 'ping') {
          // start timer now
          const startTs = Date.now();

          // send initial message (optional). We send a short measuring message then follow with time.
          await sock.sendMessage(from, { text: 'Pong — measuring...' }, quoted);

          // compute elapsed after send finished
          const elapsed = Date.now() - startTs;
          await sock.sendMessage(from, { text: `Pong — ${elapsed} ms` }, quoted);
          continue;
        }

        // ---------- STICKER ----------
        if (['sticker', 'stkr', 's'].includes(cmd)) {
          try {
            // check quoted message first (user replied to an image/document)
            const quotedMsg = message?.extendedTextMessage?.contextInfo?.quotedMessage;
            let candidate = null;
            if (quotedMsg) {
              candidate = quotedMsg.imageMessage ?? quotedMsg.documentMessage ?? null;
            }
            // fallback to direct attachments
            if (!candidate) {
              candidate = message.imageMessage ?? message.documentMessage ?? null;
            }

            if (!candidate) {
              await sock.sendMessage(from, { text: 'No image found. Send or reply to an image with caption `.sticker`' }, quoted);
              continue;
            }

            // verify it's an image (document may be image mime)
            const mimetype = candidate.mimetype ?? '';
            const isImageDoc = mimetype.startsWith?.('image/') ?? false;
            if (!isImageDoc) {
              await sock.sendMessage(from, { text: 'Found an attached file but it is not an image. Please send an image or an image-document.' }, quoted);
              continue;
            }

            // some history / sync events may not include media keys/directPath yet -> check
            const hasMediaKey = Boolean(candidate.mediaKey || candidate.directPath || candidate.fileSha256);
            if (!hasMediaKey) {
              await sock.sendMessage(from, {
                text: 'Unable to download that image (media key missing). Please re-send the image directly or reply to the original message again.'
              }, quoted);
              continue;
            }

            // download
            const stream = await downloadContentFromMessage({ message: candidate }, 'image');
            const buffer = await bufferFromStream(stream);

            // convert to webp and resize - sharp does the heavy lifting
            const webpBuf = await sharp(buffer)
              .rotate() // honor EXIF orientation
              .resize(512, 512, { fit: 'inside' })
              .webp({ quality: 80 })
              .toBuffer();

            await sock.sendMessage(from, { sticker: webpBuf }, quoted);
          } catch (err) {
            logger('sticker error', err);
            await sock.sendMessage(from, { text: `Failed to create sticker: ${err?.message ?? err}` }, quoted);
          }
          continue;
        }

        // ---------- fallback echo for dev ----------
        if (cmd === 'echo') {
          await sock.sendMessage(from, { text: args.join(' ') || 'echo' }, quoted);
          continue;
        }

        // unknown command - optionally notify
        await sock.sendMessage(from, { text: `Unknown command: ${cmd}` }, quoted);
      }
    } catch (e) {
      logger('messages.upsert handler error', e?.stack ?? e);
    }
  });

  // catch-all for other events to help debug
  sock.ev.on('messages.delete', (m) => logger('messages.delete', m));
  sock.ev.on('contacts.update', (c) => logger('contacts.update', c?.length ?? c));

  // error handling
  sock.ev.on('connection.update', (u) => {
    if (u?.lastDisconnect) {
      logger('lastDisconnect', u.lastDisconnect);
    }
  });

  logger('started socket (listening for messages)');
}

// start
startSock().catch((err) => {
  console.error('Fatal error starting socket:', err?.stack ?? err);
  process.exit(1);
});
