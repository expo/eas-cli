import type { Config } from '@jest/types';

import baseConfig from '../../jest/jest.shared.config';

const config: Config.InitialOptions = {
  ...baseConfig,
  rootDir: 'src',
  testMatch: ['**/__tests__/*-test.ts'],
  coverageReporters: ['json', 'lcov'],
  coverageDirectory: '../coverage/tests/',
  collectCoverageFrom: ['**/*.ts'],
  clearMocks: true,
  setupFilesAfterEnv: ['<rootDir>/../jest/setup-tests.ts'],
};

export default config;
