const spawn = require('@expo/spawn-async');

(async () => {
  if (!process.env.CLI_SIZE_CHECK) {
    await spawn('yarn', ['run', '-T', 'oclif', 'manifest'], { stdio: 'inherit' });
  }
})();
