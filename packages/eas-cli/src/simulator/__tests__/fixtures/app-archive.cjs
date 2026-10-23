const fs = require('fs');
const path = require('path');
const { createAppArchiveAsync } = require('../../appArchive');

async function main() {
  const [mode, bundle] = process.argv.slice(2);
  if (mode === 'pack') {
    for (let i = 0; i < 5; i++) {
      const archive = await createAppArchiveAsync(bundle);
      await archive.cleanupAsync();
    }
    return;
  }
  let timer;
  if (mode === 'interrupt-packaging') {
    timer = setInterval(() => {
      const directories = fs.readdirSync(process.env.TMPDIR);
      if (directories.some(name => name.startsWith('eas-simulator-app-') &&
        fs.existsSync(path.join(process.env.TMPDIR, name, 'app.tar.gz')))) {
        clearInterval(timer);
        console.log('interrupt-packaging');
        process.kill(process.pid, 'SIGINT');
      }
    }, 1);
  }
  const archive = await createAppArchiveAsync(bundle);
  if (mode === 'interrupt-upload') {
    console.log('interrupt-upload');
    process.kill(process.pid, 'SIGINT');
  }
  // Keep the process alive as the action transport does during upload.
  setInterval(() => {}, 1000);
}

main().catch(error => { console.error(error); process.exitCode = 1; });
