export const ora = jest.fn().mockReturnValue({
  start: jest.fn().mockReturnValue({
    fail: jest.fn(),
    succeed: jest.fn(),
  }),
  stop: jest.fn(),
  stopAndPersist: jest.fn(),
  succeed: jest.fn(),
});
