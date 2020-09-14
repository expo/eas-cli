module.exports = {
  projects: [
    require('./packages/eas-cli/jest.config.js'),
    require('./packages/config/jest.config.js'),
  ],
  testPathIgnorePatterns: ['.*'],
};
