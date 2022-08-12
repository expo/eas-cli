const { exec } = require('child_process');

if (process.env.CLI_SIZE_CHECK) {
  exec('yarn oclif manifest', (error, stdout, stderr) => {
    if (error || stderr) {
      // eslint-disable-next-line no-console
      console.error(error?.message || stderr);
      return;
    }

    // eslint-disable-next-line no-console
    console.log(stdout);
  });
}
