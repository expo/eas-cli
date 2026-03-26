import { isNonInteractiveByDefault, resolveNonInteractiveAndJsonFlags } from '../flags';

describe(isNonInteractiveByDefault, () => {
  const originalEnv = process.env;
  const originalIsTTY = process.stdin.isTTY;

  afterEach(() => {
    process.env = originalEnv;
    Object.defineProperty(process.stdin, 'isTTY', { value: originalIsTTY, writable: true });
  });

  test('returns false when stdin is a TTY and CI is not set', () => {
    process.env = { ...originalEnv };
    delete process.env.CI;
    Object.defineProperty(process.stdin, 'isTTY', { value: true, writable: true });
    expect(isNonInteractiveByDefault()).toBe(false);
  });

  test('returns true when CI=1', () => {
    process.env = { ...originalEnv, CI: '1' };
    Object.defineProperty(process.stdin, 'isTTY', { value: true, writable: true });
    expect(isNonInteractiveByDefault()).toBe(true);
  });

  test('returns true when CI=true', () => {
    process.env = { ...originalEnv, CI: 'true' };
    Object.defineProperty(process.stdin, 'isTTY', { value: true, writable: true });
    expect(isNonInteractiveByDefault()).toBe(true);
  });

  test('returns true when stdin is not a TTY', () => {
    process.env = { ...originalEnv };
    delete process.env.CI;
    Object.defineProperty(process.stdin, 'isTTY', { value: undefined, writable: true });
    expect(isNonInteractiveByDefault()).toBe(true);
  });

  test('returns true when both CI is set and stdin is not a TTY', () => {
    process.env = { ...originalEnv, CI: '1' };
    Object.defineProperty(process.stdin, 'isTTY', { value: undefined, writable: true });
    expect(isNonInteractiveByDefault()).toBe(true);
  });
});

describe(resolveNonInteractiveAndJsonFlags, () => {
  test('returns both false when no flags are set', () => {
    expect(resolveNonInteractiveAndJsonFlags({})).toEqual({
      json: false,
      nonInteractive: false,
    });
  });

  test('--json implies --non-interactive', () => {
    expect(resolveNonInteractiveAndJsonFlags({ json: true })).toEqual({
      json: true,
      nonInteractive: true,
    });
  });

  test('--non-interactive alone does not enable json', () => {
    expect(resolveNonInteractiveAndJsonFlags({ 'non-interactive': true })).toEqual({
      json: false,
      nonInteractive: true,
    });
  });

  test('both flags explicitly set', () => {
    expect(resolveNonInteractiveAndJsonFlags({ json: true, 'non-interactive': true })).toEqual({
      json: true,
      nonInteractive: true,
    });
  });

  test('both flags explicitly false', () => {
    expect(resolveNonInteractiveAndJsonFlags({ json: false, 'non-interactive': false })).toEqual({
      json: false,
      nonInteractive: false,
    });
  });

  test('--json false with --non-interactive true', () => {
    expect(resolveNonInteractiveAndJsonFlags({ json: false, 'non-interactive': true })).toEqual({
      json: false,
      nonInteractive: true,
    });
  });
});
