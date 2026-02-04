import type { Config } from '@jest/types';

// eslint-disable-next-line import/no-relative-packages
import baseConfig from '../../jest/jest.shared.config';

const config: Config.InitialOptions = {
  ...baseConfig,
  preset: 'ts-jest/presets/default-esm',
  transform: {
    '^.+\\.tsx?$': [
      'ts-jest',
      {
        tsconfig: 'tsconfig.json',
        useESM: true,
      },
    ],
  },
  rootDir: 'src',
  testMatch: ['**/__tests__/*-test.ts'],
  coverageReporters: ['json', 'lcov'],
  coverageDirectory: '../coverage/tests/',
  collectCoverageFrom: ['**/*.ts'],
  moduleNameMapper: {
    '^(\\.\\.?/.*)\\.js$': ['$1.ts', '$0'],
  },
  clearMocks: true,
  setupFilesAfterEnv: ['<rootDir>/../jest/setup-tests.ts'],
};

export default config;
