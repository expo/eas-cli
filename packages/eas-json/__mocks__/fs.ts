import { fs } from 'memfs';

// fs-extra@10 is not compatible with memfs, the following line fixes tests
(fs.realpath as any).native = jest.fn();

module.exports = fs;
