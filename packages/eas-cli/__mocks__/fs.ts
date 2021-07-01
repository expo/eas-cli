import { fs } from 'memfs';
fs.mkdirSync('/tmp');
if (process.env.TMPDIR) {
  fs.mkdirSync(process.env.TMPDIR, { recursive: true });
}
module.exports = fs;
