import { fs } from 'memfs';

// needed because of a weird bug with tempy (dependency of @expo/config-plugins)
fs.mkdirSync('/tmp');
if (process.env.TMPDIR) {
  fs.mkdirSync(process.env.TMPDIR, { recursive: true });
}

module.exports = fs;
