import type { Config } from '@jest/types';

// eslint-disable-next-line import/no-relative-packages
import baseConfig from '../../jest/jest.shared.config';

const config: Config.InitialOptions = {
  ...baseConfig,
  rootDir: __dirname,
  testMatch: ['**/__unit__/*.test.ts'],
  clearMocks: true,
  setupFilesAfterEnv: ['./jest/unit-setup.ts'],
};

export default config;
