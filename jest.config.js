module.exports = {
  projects: [
    require('./packages/eas-cli/jest.config.js'),
    require('./packages/eas-json/jest.config.js'),
    require('./packages/code-signing-certificates/jest.config.js'),
  ],
  testPathIgnorePatterns: ['.*'],
};
