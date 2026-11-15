import type { Config } from '@jest/types';

import baseConfig from '../../jest/jest.shared.config';

const config: Config.InitialOptions = {
  ...baseConfig,
  rootDir: 'src',
  testMatch: ['**/__tests__/*.test.ts'],
  setupFiles: ['<rootDir>/__tests__/fixturePids.ts'],
  clearMocks: true,
};

export default config;
