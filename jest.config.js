import easCliConfig from './packages/eas-cli/jest.config.js';
import easJsonConfig from './packages/eas-json/jest.config.js';

export default {
  projects: [easCliConfig, easJsonConfig],
  testPathIgnorePatterns: ['.*'],
};
