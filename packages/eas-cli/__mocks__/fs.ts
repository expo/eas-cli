import { fs } from 'memfs';

// needed because of a weird bug with tempy (dependency of @expo/config-plugins)
// eslint-disable-next-line node/no-sync
fs.mkdirSync('/tmp');
if (process.env.TMPDIR) {
  // eslint-disable-next-line node/no-sync
  fs.mkdirSync(process.env.TMPDIR, { recursive: true });
}

// fs-extra@10 is not compatible with memfs, the following line fixes tests
(fs.realpath as any).native = jest.fn();

module.exports = fs;

// Ensure requiring node:fs returns the mock too. This is needed for expo/config and expo/json-file.
jest.mock('node:fs', () => fs);
