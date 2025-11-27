async function sendButtons(sock, jid, text, buttons = [], quoted) {
const msg = { text, footer: 'Lux', buttons, headerType: 1 };
return sock.sendMessage(jid, msg, { quoted });
}


module.exports = { sendButtons };