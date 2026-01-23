module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  rootDir: 'src',
  testMatch: ['**/__tests__/*-test.ts'],
  coverageReporters: ['json', 'lcov'],
  coverageDirectory: '../coverage/tests/',
  collectCoverageFrom: ['**/*.ts'],
  clearMocks: true,
  setupFilesAfterEnv: ['<rootDir>/../jest/setup-tests.ts'],
};
