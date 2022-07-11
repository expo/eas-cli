module.exports = {
  projects: [
    require('./packages/eas-cli/jest.config.cjs'),
    require('./packages/eas-json/jest.config.cjs'),
  ],
  testPathIgnorePatterns: ['.*'],
};
