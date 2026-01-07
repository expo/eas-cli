module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  rootDir: 'src',
  testMatch: ['**/__integration__/*.test.ts'],
  collectCoverage: true,
  coverageReporters: ['json', 'lcov', 'text-summary'],
  coverageDirectory: '../coverage/integration',
  // Exclude main.ts - it has a self-executing main() that starts servers
  coveragePathIgnorePatterns: ['/node_modules/', 'main\\.ts$'],
  setupFilesAfterEnv: ['<rootDir>/../jest/integration-setup.ts'],
  // Force exit after tests complete to avoid false "open handles" warnings
  // from internal logger streams and WebSocket cleanup timing
  forceExit: true,
};
