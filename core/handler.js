const config = require('../config/config');
const { loadCommands } = require('../system/commandLoader');
const path = require('path');


function createHandler({ sock, db }) {
const commands = loadCommands(path.join(__dirname, '..', 'commands'));


return async function handleMessage(m) {
try {
const [message] = m.messages;
if (!message || !message.message) return;
if (message.key?.fromMe) return;


let text = '';
if (message.message.conversation) text = message.message.conversation;
else if (message.message.extendedTextMessage) text = message.message.extendedTextMessage.text;
else if (message.message.imageMessage?.caption) text = message.message.imageMessage.caption;


if (!text) return;
if (!text.startsWith(config.prefix)) return;


const [cmdName, ...args] = text.slice(config.prefix.length).trim().split(/\s+/);
const cmd = commands.get(cmdName.toLowerCase());
if (!cmd) return sock.sendMessage(message.key.remoteJid, { text: `Unknown command: ${cmdName}` }, { quoted: message });


await cmd.run({ sock, msg: message, args, db });
} catch (e) {
console.error('handler error', e);
}
};
}


module.exports = { createHandler };