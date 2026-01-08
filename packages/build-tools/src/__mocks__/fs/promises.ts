import { fs } from 'memfs';

const fsRealpath = fs.realpath;
(fsRealpath as any).native = fsRealpath;

const fsRm = (path: string, options: object): Promise<void> => {
  return fs.promises.rm(path, options);
};

module.exports = { ...fs.promises, realpath: fsRealpath, rm: fsRm };
