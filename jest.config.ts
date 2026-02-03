import type { Config } from 'jest';

// eslint-disable-next-line import/no-relative-packages
import createEasBuildFunctionConfig from './packages/create-eas-build-function/jest.config.cjs';
// eslint-disable-next-line import/no-relative-packages
import downloaderConfig from './packages/downloader/jest.config';
// eslint-disable-next-line import/no-relative-packages
import easBuildJobConfig from './packages/eas-build-job/jest.config';
// eslint-disable-next-line import/no-relative-packages
import easCliConfig from './packages/eas-cli/jest.config';
// eslint-disable-next-line import/no-relative-packages
import easJsonConfig from './packages/eas-json/jest.config';
// eslint-disable-next-line import/no-relative-packages
import loggerConfig from './packages/logger/jest.config';
// eslint-disable-next-line import/no-relative-packages
import stepsConfig from './packages/steps/jest.config.cjs';
// eslint-disable-next-line import/no-relative-packages
import templateFileConfig from './packages/template-file/jest.config';
// eslint-disable-next-line import/no-relative-packages
import turtleSpawnConfig from './packages/turtle-spawn/jest.config';
// eslint-disable-next-line import/no-relative-packages
import workerIntegrationConfig from './packages/worker/jest.config.integration';
// eslint-disable-next-line import/no-relative-packages
import workerConfig from './packages/worker/jest.config.unit';

const config: Config = {
  projects: [
    easCliConfig,
    easJsonConfig,
    workerConfig,
    workerIntegrationConfig,
    downloaderConfig,
    easBuildJobConfig,
    loggerConfig,
    stepsConfig,
    templateFileConfig,
    turtleSpawnConfig,
    createEasBuildFunctionConfig,
  ],
  testPathIgnorePatterns: ['.*'],
  watchPlugins: ['jest-watch-typeahead/filename', 'jest-watch-typeahead/testname'],
  collectCoverageFrom: ['<rootDir>/src/**/*.{ts,tsx,js,jsx}'],
};

export default config;
