import type { Config } from '@jest/types';

// eslint-disable-next-line eslint-import/no-relative-packages
import baseConfig from '../../jest/jest.shared.config';

const config: Config.InitialOptions = {
  ...baseConfig,
  rootDir: 'src',
  testMatch: ['**/__integration__/*.test.ts'],
  collectCoverage: true,
  coverageReporters: ['json', 'lcov', 'text-summary'],
  coverageDirectory: '../coverage/integration',
  // Exclude main.ts - it has a self-executing main() that starts servers
  coveragePathIgnorePatterns: ['/node_modules/', 'main\\.ts$'],
  setupFilesAfterEnv: ['<rootDir>/../jest/integration-setup.ts'],
  // Force exit after tests complete - internal async operations (logger streams,
  // WebSocket cleanup timing) may keep handles open that prevent clean exit.
  forceExit: true,
};

export default config;
