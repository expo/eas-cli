export default jest.fn().mockReturnValue({
  start: jest.fn().mockReturnValue({
    fail: jest.fn(),
    succeed: jest.fn(),
  }),
});
