const { spawn } = require('node:child_process');
const fs = require('node:fs');
const children = [0, 1].map(() =>
  spawn(process.execPath, [process.argv[2]], {
    stdio: ['ignore', 'inherit', 'inherit', 'ipc'],
  })
);
// Like a supervisor, forward parent termination and report the child's final status.
process.on('SIGTERM', () => {
  for (const child of children) child.kill('SIGTERM');
});
let ready = 0;
for (const child of children) {
  child.on('message', () => {
    if (++ready === children.length) {
      fs.writeFileSync(process.argv[3], JSON.stringify(children.map(child => child.pid)));
    }
  });
  child.on('exit', code => process.exit(code ?? 1));
}
