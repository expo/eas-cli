import type { Config } from '@jest/types';

// eslint-disable-next-line import/no-relative-packages
import baseConfig from '../../jest/jest.shared.config';

const config: Config.InitialOptions = {
  ...baseConfig,
  rootDir: 'src',
  testMatch: ['**/__tests__/*.test.ts'],
  clearMocks: true,
  setupFilesAfterEnv: ['<rootDir>/../jest/setup-tests.ts'],
};

export default config;
