const { downloadContentFromMessage } = require('@adiwajshing/baileys');
const fs = require('fs');


async function downloadMedia(message, mediaType = 'image', dest = './tmp/received') {
const stream = await downloadContentFromMessage(message, mediaType);
let buffer = Buffer.from([]);
for await (const chunk of stream) buffer = Buffer.concat([buffer, chunk]);
fs.mkdirSync(require('path').dirname(dest), { recursive: true });
fs.writeFileSync(dest, buffer);
return dest;
}


module.exports = { downloadMedia };