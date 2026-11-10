const fs = require('node:fs');
const path = require('node:path');

fs.writeFileSync(path.join(process.argv[2], 'child.pid'), String(process.pid));
setTimeout(() => fs.writeFileSync(path.join(process.argv[2], 'late-write'), 'still running'), 1000);
setInterval(() => {}, 1000);
