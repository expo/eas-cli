import { fs } from 'memfs';

const fsRealpath = fs.realpath;
(fsRealpath as any).native = fsRealpath;

module.exports = { ...fs, realpath: fsRealpath };
