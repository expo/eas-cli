/* eslint-disable no-console */

// Simulate an interactive environment so that commands default to interactive mode in tests.
// Without this, isNonInteractiveByDefault() returns true because:
// 1. Jest runs in a non-TTY environment (!process.stdin.isTTY)
// 2. CI environments set CI=1 (boolish('CI', false))
Object.defineProperty(process.stdin, 'isTTY', { value: true, writable: true });
delete process.env.CI;

beforeAll(() => {
  console.log = jest.fn();
  console.warn = jest.fn();
  console.error = jest.fn();
});
