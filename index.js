// index.js — Full bot: .sticker replies-to-image supported
// Dependencies:
// npm install @whiskeysockets/baileys@^6.7.19 pino qrcode qrcode-terminal qrcode sharp

import makeWASocket, {
  fetchLatestBaileysVersion,
  useMultiFileAuthState,
  DisconnectReason,
  downloadContentFromMessage
} from '@whiskeysockets/baileys'
import pino from 'pino'
import fs from 'fs'
import path from 'path'
import qrcodeTerminal from 'qrcode-terminal'
import QRCode from 'qrcode'
import sharp from 'sharp'

/* --------------- Config ---------------- */
const AUTH_FOLDER = './auth_info'
const QR_PNG_PATH = path.resolve('./qr.png')
const DOT_PREFIXES = ['.', '．', '｡', '․', '‧', '•', '●']

function normalizeDotPrefix(text) {
  if (!text || typeof text !== 'string') return text
  for (const p of DOT_PREFIXES) if (text.startsWith(p)) return '.' + text.slice(p.length)
  return text
}

/* --------------- Echo state (per-chat) --------------- */
// echoState[jid] === false  -> echo disabled for that chat
// echoState[jid] === true   -> echo enabled
// echoState[jid] === undefined -> treated as enabled (default)
const echoState = Object.create(null)

/* ---------------- Commands ---------------- */
const commands = {
  help: {
    exec: async ({ send, from }) =>
      send(from, {
        text:
`*Available Commands (DOT prefix)*

.say <text> — Bot repeats text
.echo <text> — Echo with "Echo:" prefix
.ping — Check latency
.sticker — Send an image with caption ".sticker" or reply ".sticker" to an image
.echoon — Enable echo mode for this chat
.echooff — Disable echo mode for this chat
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

  echoon: {
    exec: async ({ send, from }) => {
      echoState[from] = true
      await send(from, { text: '✅ Echo mode enabled for this chat.' })
    }
  },

  echooff: {
    exec: async ({ send, from }) => {
      echoState[from] = false
      await send(from, { text: '🔇 Echo mode disabled for this chat.' })
    }
  }
}

async function runCommand(name, ctx) {
  const cmd = commands[name]
  if (!cmd) return ctx.send(ctx.from, { text: `Unknown command: ${name}\nType .help` })
  return cmd.exec(ctx)
}

/* ------------- extractText (robust) ------------- */
function extractText(msg) {
  if (!msg || !msg.message) return null
  const m = msg.message
  const get = (fn) => { try { return fn() } catch { return undefined } }

  const candidates = [
    get(() => m.conversation),
    get(() => m.extendedTextMessage?.text),
    get(() => m.imageMessage?.caption),
    get(() => m.videoMessage?.caption),
    get(() => m.documentMessage?.caption),
    get(() => m.stickerMessage?.text),

    get(() => m.buttonsResponseMessage?.selectedDisplayText),
    get(() => m.buttonsResponseMessage?.selectedButtonId),
    get(() => m.listResponseMessage?.title),
    get(() => m.listResponseMessage?.singleSelectReply?.selectedRowId),
    get(() => m.templateButtonReplyMessage?.selectedDisplayText),
    get(() => m.templateButtonReplyMessage?.selectedId),

    get(() => m.ephemeralMessage?.message?.conversation),
    get(() => m.ephemeralMessage?.message?.extendedTextMessage?.text),
    get(() => m.ephemeralMessage?.message?.imageMessage?.caption),

    get(() => m.viewOnceMessage?.message?.conversation),
    get(() => m.viewOnceMessage?.message?.extendedTextMessage?.text),
    get(() => m.viewOnceMessage?.message?.imageMessage?.caption),

    get(() => m.deviceSentMessage?.message?.conversation),
    get(() => m.deviceSentMessage?.message?.extendedTextMessage?.text),

    get(() => m.extendedTextMessage?.contextInfo?.quotedMessage?.conversation),
    get(() => m.extendedTextMessage?.contextInfo?.quotedMessage?.extendedTextMessage?.text),
    get(() => m.extendedTextMessage?.contextInfo?.quotedMessage?.imageMessage?.caption),

    get(() => m.reactionMessage?.text),
    get(() => m.protocolMessage && String(m.protocolMessage?.type)),
  ]

  for (const c of candidates) if (typeof c === 'string' && c.trim() !== '') return c
  return null
}

/* ---------- findImageMessageInMsg (robust) ---------- */
function findImageMessageInMsg(msg) {
  if (!msg || !msg.message) return null
  const m = msg.message
  const tryGet = (fn) => { try { return fn() } catch { return undefined } }

  const candidates = [
    tryGet(() => m.imageMessage),
    tryGet(() => m.extendedTextMessage?.contextInfo?.quotedMessage?.imageMessage),
    tryGet(() => m.extendedTextMessage?.contextInfo?.quotedMessage?.ephemeralMessage?.message?.imageMessage),
    tryGet(() => m.ephemeralMessage?.message?.imageMessage),
    tryGet(() => m.viewOnceMessage?.message?.imageMessage),
    tryGet(() => m.deviceSentMessage?.message?.imageMessage),
    tryGet(() => m.extendedTextMessage?.contextInfo?.quotedMessage?.extendedTextMessage?.contextInfo?.quotedMessage?.imageMessage),
    tryGet(() => m.extendedTextMessage?.contextInfo?.quotedMessage?.extendedTextMessage?.text && m.extendedTextMessage?.contextInfo?.quotedMessage?.imageMessage)
  ]

  for (const c of candidates) if (c && typeof c === 'object') return c
  return null
}

/* ------------- sticker helper ------------- */
async function downloadImageAndConvertToWebp(msgImage, sock) {
  if (!msgImage) throw new Error('No imageMessage provided')
  const stream = await downloadContentFromMessage(msgImage, 'image')
  let buffer = Buffer.from([])
  for await (const chunk of stream) buffer = Buffer.concat([buffer, chunk])

  const webpBuffer = await sharp(buffer)
    .rotate()
    .resize(512, 512, { fit: 'cover' })
    .webp({ quality: 90 })
    .toBuffer()

  return webpBuffer
}

/* ---------------- Main bot ---------------- */
async function startSock() {
  const logger = pino({ level: 'info' })

  const { state, saveCreds } = await useMultiFileAuthState(AUTH_FOLDER)

  let version = undefined
  try {
    const res = await fetchLatestBaileysVersion()
    version = res.version
    logger.info({ version, isLatest: res.isLatest }, 'fetched baileys version')
  } catch (e) {
    logger.warn('Could not fetch latest Baileys version; proceeding with default')
  }

  const sock = makeWASocket({ logger, auth: state, version })
  sock.ev.on('creds.update', saveCreds)

  sock.ev.on('connection.update', async (update) => {
    const { connection, lastDisconnect, qr } = update
    logger.info({ update }, 'connection.update')

    if (qr) {
      try { qrcodeTerminal.generate(qr, { small: true }) } catch {}
      try { await QRCode.toFile(QR_PNG_PATH, qr, { margin: 2 }) } catch {}
      try { fs.writeFileSync('./qr.txt', qr, 'utf8') } catch {}
    }

    if (connection === 'open') {
      logger.info('✅ Connected to WhatsApp')
      try { if (fs.existsSync(QR_PNG_PATH)) fs.unlinkSync(QR_PNG_PATH) } catch {}
      try { if (fs.existsSync('./qr.txt')) fs.unlinkSync('./qr.txt') } catch {}
    }

    if (connection === 'close') {
      let reason = undefined
      try {
        reason = lastDisconnect?.error?.output?.statusCode
          ?? lastDisconnect?.error?.statusCode
          ?? lastDisconnect?.error?.data?.tag?.attrs?.code
          ?? undefined
      } catch (e) { reason = undefined }

      logger.warn({ reason, lastDisconnect }, 'connection closed')

      if (reason === DisconnectReason.loggedOut) {
        logger.error('Logged out — removing auth folder for fresh login')
        try { if (fs.existsSync(AUTH_FOLDER)) fs.rmSync(AUTH_FOLDER, { recursive: true, force: true }) } catch (err) { logger.error({ err }, 'failed to delete auth folder') }
        process.exit(0)
      }

      logger.info('Reconnecting in 2s...')
      setTimeout(() => startSock(), 2000)
    }
  })

  // messages.upsert handler
  sock.ev.on('messages.upsert', async (m) => {
    try {
      if (m.type !== 'notify') return

      for (const msg of m.messages) {
        if (!msg) continue
        if (msg.key.fromMe) continue
        if (msg.key.remoteJid === 'status@broadcast') continue

        const jid = msg.key.remoteJid
        const msgId = msg.key.id || '<no-id>'

        const raw = extractText(msg)

        // debug (optional)
        console.log('--- incoming message ---')
        console.log(`from: ${jid} id: ${msgId}`)
        console.log('rawText visible:', JSON.stringify(raw))
        console.log('message top keys:', Object.keys(msg.message || {}).slice(0, 8))
        console.log('------------------------')

        // clean and normalize
        let cleaned = raw ? raw.trim().replace(/^[\u200E\u200F\u202A-\u202E]+/, '') : ''
        cleaned = normalizeDotPrefix(cleaned)

        // send helper & timestamp
        const send = async (to, content) => sock.sendMessage(to, content)
        const receivedAt = (msg?.messageTimestamp ? Number(msg.messageTimestamp) * 1000 : Date.now())

        // If the message text is command-like
        if (cleaned.startsWith('.')) {
          const body = cleaned.slice(1).trim()
          const [cmdName, ...args] = body.split(/\s+/)
          const lower = (cmdName || '').toLowerCase()

          console.log('COMMAND:', lower, args)

          if (lower === 'sticker') {
            try {
              // find image in message or quoted message using helper
              const imageMessage = findImageMessageInMsg(msg)

              if (!imageMessage) {
                // If no image found, prompt user
                await send(jid, { text: 'No image found. Send an image with caption ".sticker" or reply ".sticker" to an image.' })
              } else {
                // download & convert
                const webp = await downloadImageAndConvertToWebp(imageMessage, sock)
                // send sticker
                await sock.sendMessage(jid, { sticker: webp })
                console.log('Sent sticker to', jid)
              }
            } catch (err) {
              console.error('sticker creation error', err)
              await send(jid, { text: 'Failed to create sticker: ' + (err.message || String(err)) })
            }
            continue
          }

          // other commands
          try {
            await runCommand(lower, { send, from: jid, args, receivedAt, msg })
          } catch (errCmd) {
            console.error('command error', errCmd)
            await send(jid, { text: `Command error: ${errCmd.message || String(errCmd)}` })
          }
          continue
        }

        // not a command -> fallback echo IF echo mode is enabled for this chat
        // default: echo is ON unless explicitly turned off via .echooff
        const echoEnabled = echoState[jid] !== false
        if (cleaned && echoEnabled) {
          await send(jid, { text: `Echo: ${cleaned}\n(automated reply)` })
        }
      }
    } catch (err) {
      logger.error({ err }, 'error in messages.upsert handler')
    }
  })

  sock.ev.on('contacts.update', (contacts) => logger.info({ contacts }, 'contacts.update'))

  return sock
}

/* ----------------- Start ----------------- */
startSock().catch(err => {
  console.error('startSock failed', err)
  process.exit(1)
})
