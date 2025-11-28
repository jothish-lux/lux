// commands/help.js
const { readdirSync } = require('fs');
const { join } = require('path');

module.exports = {
  name: 'help',
  aliases: ['h', 'commands'],
  description: 'Show available commands',
  async execute({ msg, client, config }) {
    try {
      const dir = join(__dirname);
      const files = readdirSync(dir).filter(f => f.endsWith('.js'));
      const cmds = [];
      for (const f of files) {
        const cmd = require(join(dir, f));
        if (!cmd || !cmd.name) continue;
        cmds.push(`• ${cmd.name}${cmd.aliases ? ` (aliases: ${cmd.aliases.join(',')})` : ''} — ${cmd.description || ''}`);
      }
      const text = `Available commands:\n\n${cmds.join('\n')}\n\nPrefix: ${config.PREFIX}`;
      await client.sendMessage(msg.key.remoteJid, { text }, { quoted: msg });
    } catch (e) {
      console.error('help error', e);
    }
  },
};
