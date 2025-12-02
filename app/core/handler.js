// core/handler.js
const { loadCommands } = require('./commands');

/**
 * init - attach message handler to a Baileys client
 * @param {object} params
 * @param {import('@adiwajshing/baileys').WASocket} params.client
 * @param {object} params.db - simple db adapter with get/set methods
 * @param {object} params.config - config object {PREFIX, OWNER}
 */
function init({ client, db, config }) {
  const commands = loadCommands();

  client.ev.on('messages.upsert', async (m) => {
    try {
      const messages = m.messages;
      if (!messages || !messages.length) return;
      const msg = messages[0];

      // ignore non-user messages and our own messages
      if (!msg.message || msg.key?.fromMe) return;

      // get text from message (covers plain and extended text)
      let text =
        msg.message.conversation ||
        msg.message.extendedTextMessage?.text ||
        msg.message.imageMessage?.caption ||
        msg.message.videoMessage?.caption ||
        '';
      text = (text || '').trim();
      if (!text) return;

      const prefix = config.PREFIX || '!';
      if (!text.startsWith(prefix)) return;

      const withoutPrefix = text.slice(prefix.length).trim();
      if (!withoutPrefix) return;
      const [cmdNameRaw, ...args] = withoutPrefix.split(/\s+/);
      const cmdName = cmdNameRaw.toLowerCase();

      const cmd = commands.get(cmdName);
      if (!cmd) {
        // unknown command: optionally reply or ignore
        return;
      }

      // permission checks
      const sender = msg.key.participant || msg.key.remoteJid;
      const isOwner = (Array.isArray(config.OWNER) ? config.OWNER : [config.OWNER]).includes(sender);

      if (cmd.ownerOnly && !isOwner) {
        await client.sendMessage(msg.key.remoteJid, { text: '❌ Owner-only command.' }, { quoted: msg });
        return;
      }

      if (cmd.groupOnly && !msg.key.remoteJid.endsWith('@g.us')) {
        await client.sendMessage(msg.key.remoteJid, { text: '❌ This command works only in groups.' }, { quoted: msg });
        return;
      }

      // execute command
      try {
        await cmd.execute({
          msg,
          client,
          db,
          args,
          config,
        });
      } catch (err) {
        console.error('command execute error', err);
        await client.sendMessage(msg.key.remoteJid, { text: `⚠️ Command error: ${String(err.message || err)}` }, { quoted: msg });
      }
    } catch (e) {
      console.error('handler outer error', e);
    }
  });
}

module.exports = { init };
