// commands/ping.js
module.exports = {
  name: 'ping',
  aliases: ['p'],
  description: 'Respond with Pong and latency',
  async execute({ msg, client }) {
    try {
      const now = Date.now();
      // messageTimestamp is in seconds, if not available fallback to now
      const msgTs = (msg.messageTimestamp || (msg.message && msg.message.timestamp) || Math.floor(now / 1000)) * 1000;
      const latency = now - msgTs;
      await client.sendMessage(msg.key.remoteJid, { text: `Pong — latency ${latency} ms` }, { quoted: msg });
    } catch (e) {
      console.error('ping error', e);
    }
  },
};
