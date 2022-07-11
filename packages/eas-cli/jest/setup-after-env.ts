import { jest } from '@jest/globals';

/* eslint-disable no-console */
beforeAll(() => {
  console.log = jest.fn();
  console.warn = jest.fn();
  console.error = jest.fn();
});
