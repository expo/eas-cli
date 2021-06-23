import { isWildcardBundleIdentifier } from '../AppleAppIdentifierUtils';

describe(isWildcardBundleIdentifier, () => {
  it('classifies wildcard bundle identifiers correctly', async () => {
    expect(isWildcardBundleIdentifier('doge.doge.*')).toBe(true);
    expect(isWildcardBundleIdentifier('doge*')).toBe(true);

    expect(isWildcardBundleIdentifier('*')).toBe(false);
    expect(isWildcardBundleIdentifier('*.doge')).toBe(false);
    expect(isWildcardBundleIdentifier('doge')).toBe(false);
    expect(isWildcardBundleIdentifier('doge.doge.doge')).toBe(false);
  });
});
