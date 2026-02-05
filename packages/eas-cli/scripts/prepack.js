const spawn = require('@expo/spawn-async');

(async () => {
  if (!process.env.CLI_SIZE_CHECK) {
    await spawn('bunx', ['oclif', 'manifest'], { stdio: 'inherit' });
  }
})();
