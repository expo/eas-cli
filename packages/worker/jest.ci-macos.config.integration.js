module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  rootDir: 'src',
  testMatch: [ '**/__integration__/*.test.ios.ts' ],
  collectCoverage: true,
  coverageReporters: ['json', 'lcov', 'text-summary'],
  coverageDirectory: '../coverage/integration',
  setupFilesAfterEnv: ['<rootDir>/../jest/integration-setup.ts'],
};
