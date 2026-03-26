import type { Config } from '@jest/types';

import baseConfig from '../../../jest/jest.shared.config';

const config: Config.InitialOptions = {
  ...baseConfig,
  rootDir: '../src',
  testMatch: ['**/__integration-tests__/*.test.ts'],
  clearMocks: true,
  setupFilesAfterEnv: ['<rootDir>/../jest/setup-tests.ts'],
};

export default config;
