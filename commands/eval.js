// commands/eval.js
module.exports = {
  name: 'eval',
  aliases: ['>'],
  description: 'Evaluate JavaScript (owner only)',
  ownerOnly: true,
  async execute({ msg, client, args, config }) {
    try {
      const code = args.join(' ');
      if (!code) {
        await client.sendMessage(msg.key.remoteJid, { text: 'Usage: eval <js>' }, { quoted: msg });
        return;
      }

      let result;
      try {
        // eslint-disable-next-line no-eval
        result = eval(code);
        if (result instanceof Promise) result = await result;
      } catch (err) {
        result = err.toString();
      }

      const out = typeof result === 'string' ? result : JSON.stringify(result, null, 2);
      await client.sendMessage(msg.key.remoteJid, { text: `\`\`\`\n${String(out).slice(0, 1900)}\n\`\`\`` }, { quoted: msg });
    } catch (e) {
      console.error('eval error', e);
    }
  },
};
