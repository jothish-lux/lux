module.exports = {
name: 'help',
description: 'lists available commands',
async run({ sock, msg, args, db }) {
// simple help: scan commands folder
const helpText = `Lux bot — available commands:\n!ping — check latency\n!help — this message`;
await sock.sendMessage(msg.key.remoteJid, { text: helpText }, { quoted: msg });
}
};