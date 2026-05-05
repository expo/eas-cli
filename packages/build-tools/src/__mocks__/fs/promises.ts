import { fs } from 'memfs';

const fsRm = (path: string, options: object): Promise<void> => {
  return fs.promises.rm(path, options);
};

module.exports = { ...fs.promises, rm: fsRm };
