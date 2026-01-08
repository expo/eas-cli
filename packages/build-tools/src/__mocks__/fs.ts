import { fs } from 'memfs';

const fsRealpath = fs.realpath;
(fsRealpath as any).native = fsRealpath;

const fsRm = (
  path: string,
  options: object,
  callback: (err: NodeJS.ErrnoException | null) => void
): void => {
  fs.promises
    .rm(path, options)
    .then(() => {
      callback(null);
    })
    .catch((err) => {
      callback(err);
    });
};

module.exports = { ...fs, realpath: fsRealpath, rm: fsRm };
