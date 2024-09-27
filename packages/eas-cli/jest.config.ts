import type { Config } from 'jest';

// eslint-disable-next-line import/no-relative-packages
import baseConfig from '../../jest/jest.config';

const config: Config = {
  ...baseConfig,
  rootDir: __dirname,
  roots: ['src', '__mocks__'],
  globalSetup: './jest/global-setup.ts',
  setupFilesAfterEnv: ['./jest/setup-after-env.ts'],
};

export default config;
