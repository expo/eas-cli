import type { Config } from 'jest';

// eslint-disable-next-line import/no-relative-packages
import easCliConfig from './packages/eas-cli/jest.config';
// eslint-disable-next-line import/no-relative-packages
import easJsonConfig from './packages/eas-json/jest.config';

const config: Config = {
  projects: [easCliConfig, easJsonConfig],
  testPathIgnorePatterns: ['.*'],
  watchPlugins: ['jest-watch-typeahead/filename', 'jest-watch-typeahead/testname'],
  collectCoverageFrom: ['<rootDir>/src/**/*.{ts,tsx,js,jsx}'],
};

export default config;
