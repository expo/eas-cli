import type { Config } from '@jest/types';

// eslint-disable-next-line eslint-import/no-relative-packages
import baseConfig from '../../jest/jest.shared.config';

const config: Config.InitialOptions = {
  ...baseConfig,
  rootDir: __dirname,
  roots: ['src', '__mocks__'],
  testRegex: '/__tests__/.*(test|spec)\\.[jt]sx?$',
  globalSetup: './jest/global-setup.ts',
  setupFilesAfterEnv: ['./jest/setup-after-env.ts'],
};

export default config;
