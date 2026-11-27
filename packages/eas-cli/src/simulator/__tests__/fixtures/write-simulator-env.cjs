const path = require('node:path');
const lockfile = require('proper-lockfile');
const cli = path.resolve(__dirname, '../../../..');
require('ts-node').register({ project: path.join(cli, 'tsconfig.json'), transpileOnly: true });
const { writeSimulatorEnvAsync, EAS_SIMULATOR_SESSION_ID } = require('../../env.ts');

// Tell the parent exactly when the writer contends, without racing a sleep against startup.
const lock = lockfile.lock;
lockfile.lock = async (file, options) => {
  try {
    return await lock(file, { ...options, retries: 0 });
  } catch (err) {
    if (err.code !== 'ELOCKED') throw err;
    process.send('contended');
    return lock(file, options);
  }
};
writeSimulatorEnvAsync(process.argv[2], { [EAS_SIMULATOR_SESSION_ID]: 'new-session' }).catch(
  err => {
    console.error(err);
    process.exitCode = 1;
  }
);
