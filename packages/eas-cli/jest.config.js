module.exports = {
  ...require('../../jest/jest.config.js'),
  rootDir: __dirname,
  roots: ['src', '__mocks__'],
  globalSetup: './jest/global-setup.ts',
  setupFilesAfterEnv: ['./jest/setup-after-env.ts'],
};
