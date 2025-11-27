module.exports = {
name: 'sticker',
description: 'convert image to sticker (scaffold, requires ffmpeg)',
async run({ sock, msg }) {
await sock.sendMessage(msg.key.remoteJid, { text: 'Sticker plugin scaffold: implement media download + ffmpeg conversion.' }, { quoted: msg });
}
};