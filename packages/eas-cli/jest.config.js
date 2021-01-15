module.exports = {
  ...require('../../jest/jest.config.js'),
  rootDir: __dirname,
  roots: ['src', '__mocks__'],
  globalSetup: './global-setup.ts',
};
