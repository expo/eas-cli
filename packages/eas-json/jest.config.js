import { dirname } from 'path';
import { fileURLToPath } from 'url';

import baseConfig from '../../jest/jest.config.js';

const filename = fileURLToPath(import.meta.url);
// eslint-disable-next-line no-underscore-dangle
const __dirname = dirname(filename);

export default {
  ...baseConfig,
  rootDir: __dirname,
  roots: ['src', '__mocks__'],
};
