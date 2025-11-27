module.exports = {
name: 'ping',
description: 'responds with Pong and latency',
async run({ sock, msg }) {
const t0 = Date.now();
await sock.sendMessage(msg.key.remoteJid, { text: 'Pinging...' }, { quoted: msg });
const t1 = Date.now() - t0;
await sock.sendMessage(msg.key.remoteJid, { text: `Pong — ${t1}ms` }, { quoted: msg });
}
};