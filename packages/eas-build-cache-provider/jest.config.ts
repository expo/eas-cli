import type { Config } from '@jest/types';

import baseConfig from '../../jest/jest.shared.config';

const config: Config.InitialOptions = {
  ...baseConfig,
  rootDir: __dirname,
  roots: ['src'],
  testRegex: '/__tests__/.*(test|spec)\\.[jt]sx?$',
};

export default config;
