import type { Config } from 'jest';

export default {
  preset: 'ts-jest',
  testEnvironment: 'node',
  rootDir: __dirname,
  testMatch: ['**/__unit__/*.test.ts'],
  clearMocks: true,
  setupFilesAfterEnv: ['./jest/unit-setup.ts'],
} satisfies Config;
