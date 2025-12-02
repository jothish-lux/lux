// index.js — Full Baileys v6+ bot with robust extractText() (Business-compatible) + DOT prefix
// Install dependencies before running:
// npm install @whiskeysockets/baileys@^6.7.19 pino qrcode qrcode-terminal
//
// Then run: node index.js
//
// Features:
// - useMultiFileAuthState auth persistence
// - terminal QR + qr.png output
// - defensive connection handling + reconnect
// - robust extractText() that handles many WhatsApp / Business shapes (ephemeral, viewOnce, deviceSent, quoted, buttons, lists, templates)
// - DOT prefix commands (.help, .ping, .say, .echo, .sticker)
// - Unicode-safe dot-like prefix normalization

import makeWASocket, {
  fetchLatestBaileysVersion,
  useMultiFileAuthState,
  DisconnectReason
} from '@whiskeysockets/baileys'
import pino from 'pino'
import fs from 'fs'
import path from 'path'
import qrcodeTerminal from 'qrcode-terminal'
import QRCode from 'qrcode'

/* ---------------- Config ---------------- */
const AUTH_FOLDER = './auth_info'
const QR_PNG_PATH = path.resolve('./qr.png')

// Accept dot-like prefixes (normalize to '.')
const DOT_PREFIXES = [
  '.',   // U+002E ASCII dot
  '．',  // U+FF0E full-width dot
  '｡',   // U+FF61 half-width ideographic full stop
  '․',   // U+2024 one-dot leader
  '‧',   // U+2027 bullet operator
  '•',   // U+2022 bullet
  '●'    // U+25CF black circle
]

function normalizeDotPrefix(text) {
  if (!text || typeof text !== 'string') return text
  for (const p of DOT_PREFIXES) {
    if (text.startsWith(p)) return '.' + text.slice(p.length)
  }
  return text
}

/* --------------- Commands ---------------- */
const commands = {
  help: {
    exec: async ({ send, from }) =>
      send(from, {
        text:
`*Available Commands (DOT prefix)*

.say <text> — Bot repeats text
.echo <text> — Echo with "Echo:" prefix
.ping — Check latency
.sticker — Send an image with caption ".sticker" (placeholder)
.help — Show this message`
      })
  },

  ping: {
    exec: async ({ send, from, receivedAt }) => {
      const now = Date.now()
      await send(from, { text: `Pong — ${now - receivedAt}ms` })
    }
  },

  say: {
    exec: async ({ send, from, args }) => {
      const text = args.join(' ').trim()
      if (!text) return send(from, { text: 'Usage: .say hello' })
      await send(from, { text })
    }
  },

  echo: {
    exec: async ({ send, from, args }) => {
      const text = args.join(' ').trim()
      if (!text) return send(from, { text: 'Usage: .echo hello' })
      await send(from, { text: `Echo: ${text}\n(automated reply)` })
    }
  },

  sticker: {
    exec: async ({ send, from }) => {
      await send(from, {
        text:
`To create a sticker: send an image with caption ".sticker" or reply ".sticker" to an image.
If you want, I can implement automatic image→sticker conversion (requires sharp/webp tooling).`
      })
    }
  }
}

async function runCommand(name, ctx) {
  const cmd = commands[name]
  if (!cmd) {
    return ctx.send(ctx.from, { text: `Unknown command: ${name}\nType .help` })
  }
  return cmd.exec(ctx)
}

/* ------------- Text extraction ------------- */
/**
 * extractText(msg)
 * - returns a string containing the user-visible text for the message, or null.
 * - covers many message shapes used by WhatsApp & Business accounts:
 *   conversation, extendedTextMessage, image/video/document captions,
 *   ephemeralMessage, viewOnceMessage, deviceSentMessage,
 *   buttonsResponseMessage, listResponseMessage, templateButtonReplyMessage,
 *   quoted message text (contextInfo.quotedMessage), etc.
 */
function extractText(msg) {
  if (!msg || !msg.message) return null
  const m = msg.message

  // helper to safely access nested values
  const get = (fn) => {
    try { return fn() } catch { return undefined }
  }

  // Candidate extraction order — start with simplest shapes then wrappers
  const candidates = [
    // Standard shapes
    get(() => m.conversation),
    get(() => m.extendedTextMessage?.text),
    get(() => m.imageMessage?.caption),
    get(() => m.videoMessage?.caption),
    get(() => m.documentMessage?.caption),
    get(() => m.stickerMessage?.text), // rare

    // Button / list / template responses
    get(() => m.buttonsResponseMessage?.selectedDisplayText),
    get(() => m.buttonsResponseMessage?.selectedButtonId),
    get(() => m.listResponseMessage?.title),
    get(() => m.listResponseMessage?.singleSelectReply?.selectedRowId),
    get(() => m.templateButtonReplyMessage?.selectedDisplayText),
    get(() => m.templateButtonReplyMessage?.selectedId),

    // Ephemeral wrapper (disappearing messages)
    get(() => m.ephemeralMessage?.message?.conversation),
    get(() => m.ephemeralMessage?.message?.extendedTextMessage?.text),
    get(() => m.ephemeralMessage?.message?.imageMessage?.caption),
    get(() => m.ephemeralMessage?.message?.videoMessage?.caption),
    get(() => m.ephemeralMessage?.message?.documentMessage?.caption),

    // viewOnce wrapper
    get(() => m.viewOnceMessage?.message?.conversation),
    get(() => m.viewOnceMessage?.message?.extendedTextMessage?.text),
    get(() => m.viewOnceMessage?.message?.imageMessage?.caption),

    // device-sent wrapper
    get(() => m.deviceSentMessage?.message?.conversation),
    get(() => m.deviceSentMessage?.message?.extendedTextMessage?.text),

    // quoted message (when user replies to something and command may be inside quoted)
    get(() => m.extendedTextMessage?.contextInfo?.quotedMessage?.conversation),
    get(() => m.extendedTextMessage?.contextInfo?.quotedMessage?.extendedTextMessage?.text),
    get(() => m.extendedTextMessage?.contextInfo?.quotedMessage?.imageMessage?.caption),
    get(() => m.extendedTextMessage?.contextInfo?.quotedMessage?.videoMessage?.caption),

    // reaction / protocol / other less common shapes (try best-effort)
    get(() => m.reactionMessage?.text),
    get(() => m.protocolMessage?.type && String(m.protocolMessage?.type)),
  ]

  for (const c of candidates) {
    if (typeof c === 'string' && c.trim() !== '') return c
  }

  return null
}

/* ---------------- Main bot ----------------- */
async function startSock() {
  const logger = pino({ level: 'info' })

  // load or create persistent auth state
  const { state, saveCreds } = await useMultiFileAuthState(AUTH_FOLDER)

  // optional: fetch WA version to avoid mismatches
  let version = undefined
  try {
    const res = await fetchLatestBaileysVersion()
    version = res.version
    logger.info({ version, isLatest: res.isLatest }, 'fetched baileys version')
  } catch (e) {
    logger.warn('Could not fetch latest baileys version; using default')
  }

  const sock = makeWASocket({
    logger,
    auth: state,
    version
  })

  // persist creds on update
  sock.ev.on('creds.update', saveCreds)

  // connection updates: QR handling, open, close
  sock.ev.on('connection.update', async (update) => {
    const { connection, lastDisconnect, qr } = update
    logger.info({ update }, 'connection.update')

    if (qr) {
      try {
        qrcodeTerminal.generate(qr, { small: true }, q => {
          console.log('\nScan this QR (Linked devices → Link a device):\n')
          console.log(q)
        })
      } catch (err) {
        logger.warn({ err }, 'failed to generate terminal QR')
      }

      try {
        await QRCode.toFile(QR_PNG_PATH, qr, { margin: 2 })
        logger.info({ qrFile: QR_PNG_PATH }, 'wrote QR to file — download/open this image to scan')
      } catch (err) {
        logger.warn({ err }, 'failed to write QR png')
      }

      try { fs.writeFileSync('./qr.txt', qr, 'utf8') } catch {}
    }

    if (connection === 'open') {
      logger.info('✅ Connected to WhatsApp')
      // cleanup QR artifacts if present
      try { if (fs.existsSync(QR_PNG_PATH)) fs.unlinkSync(QR_PNG_PATH) } catch {}
      try { if (fs.existsSync('./qr.txt')) fs.unlinkSync('./qr.txt') } catch {}
    }

    if (connection === 'close') {
      // defensive extraction of reason/status code
      let reason = undefined
      try {
        reason = lastDisconnect?.error?.output?.statusCode
          ?? lastDisconnect?.error?.statusCode
          ?? lastDisconnect?.error?.data?.tag?.attrs?.code
          ?? undefined
      } catch (e) { reason = undefined }

      logger.warn({ reason, lastDisconnect }, 'connection closed')

      if (reason === DisconnectReason.loggedOut) {
        logger.error('Logged out — cleaning auth folder for fresh login')
        try {
          if (fs.existsSync(AUTH_FOLDER)) fs.rmSync(AUTH_FOLDER, { recursive: true, force: true })
        } catch (err) {
          logger.error({ err }, 'failed to delete auth folder')
        }
        process.exit(0)
      }

      // otherwise try reconnecting
      logger.info('Reconnecting in 2s...')
      setTimeout(() => startSock(), 2000)
    }
  })

  // messages.upsert: main handler
  sock.ev.on('messages.upsert', async (m) => {
    try {
      if (m.type !== 'notify') return

      for (const msg of m.messages) {
        if (!msg) continue
        if (msg.key.fromMe) continue
        if (msg.key.remoteJid === 'status@broadcast') continue

        const jid = msg.key.remoteJid
        const msgId = msg.key.id || '<no-id>'

        // extract visible text from many shapes (Business-compatible)
        const raw = extractText(msg)

        // Debug log to help diagnose shapes (remove if noisy)
        console.log('--- incoming message ---')
        console.log(`from: ${jid} id: ${msgId}`)
        console.log('rawText visible:', JSON.stringify(raw))
        console.log('message top keys:', Object.keys(msg.message || {}).slice(0, 8))
        console.log('------------------------')

        if (!raw) {
          // nothing to parse — ignore or handle media replies
          continue
        }

        // strip whitespace & invisible markers (LRM/RLM etc.)
        let cleaned = raw.trim().replace(/^[\u200E\u200F\u202A-\u202E]+/, '')

        // normalize dot-like prefix to '.'
        cleaned = normalizeDotPrefix(cleaned)

        // send helper
        const send = async (to, content) => sock.sendMessage(to, content)
        const receivedAt = (msg?.messageTimestamp ? Number(msg.messageTimestamp) * 1000 : Date.now())

        // If dot-prefixed command
        if (cleaned.startsWith('.')) {
          const body = cleaned.slice(1).trim()
          const [cmdName, ...args] = body.split(/\s+/)
          const lower = (cmdName || '').toLowerCase()
          console.log(`Detected command ".${lower}" args:`, args)
          await runCommand(lower, { send, from: jid, args, receivedAt, msg })
        } else {
          // fallback: echo original text (keeps previous behavior)
          await send(jid, { text: `Echo: ${cleaned}\n(automated reply)` })
        }
      }
    } catch (err) {
      logger.error({ err }, 'error in messages.upsert handler')
    }
  })

  // optional: contact updates logger
  sock.ev.on('contacts.update', (c) => logger.info({ c }, 'contacts.update'))

  return sock
}

/* ----------------- Start ------------------ */
startSock().catch(err => {
  console.error('startSock failed', err)
  process.exit(1)
})
