import { isCI } from '../ci';

describe(isCI, () => {
  const originalCI = process.env.CI;

  afterEach(() => {
    if (originalCI === undefined) {
      delete process.env.CI;
    } else {
      process.env.CI = originalCI;
    }
  });

  it.each(['true', 'TRUE', 'True', '1', 'yes', 'woodpecker'])('treats CI=%s as CI', value => {
    process.env.CI = value;
    expect(isCI()).toBe(true);
  });

  it.each(['false', 'FALSE', '0', ''])('treats CI=%s as not CI', value => {
    process.env.CI = value;
    expect(isCI()).toBe(false);
  });

  it('treats an unset CI as not CI', () => {
    delete process.env.CI;
    expect(isCI()).toBe(false);
  });

  it('loads ora without throwing when CI=TRUE, as Xcode Cloud sets it', () => {
    process.env.CI = 'TRUE';
    jest.isolateModules(() => {
      const { isSpinnerEnabled } = jest.requireActual('../../ora');
      expect(isSpinnerEnabled()).toBe(false);
    });
  });
});
