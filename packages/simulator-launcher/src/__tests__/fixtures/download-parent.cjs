const { spawn } = require('node:child_process');
const path = require('node:path');

const child = spawn(process.execPath, [path.join(__dirname, 'download-child.cjs'), process.argv[2]], {
  stdio: ['ignore', 'inherit', 'inherit'],
});
if (process.argv[3] === 'exit') {
  child.unref();
} else {
  setInterval(() => {}, 1000);
}
