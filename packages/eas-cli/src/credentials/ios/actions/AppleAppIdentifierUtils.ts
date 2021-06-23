export function isWildcardBundleIdentifier(bundleIdentifier: string): boolean {
  const wildcardRegex = /^[A-Za-z0-9.-]+\*$/;
  return wildcardRegex.test(bundleIdentifier);
}
