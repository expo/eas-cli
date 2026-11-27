/** `CI` values that mean "not in CI", compared in lowercase. An empty value is not CI either. */
const NOT_CI_VALUES = new Set(['false', '0', 'no', 'off']);

/**
 * Whether the CLI runs in CI. `CI` counts unless it is empty, `false`, `0`, `no` or `off`, in any case.
 * CI providers set it to different values, e.g. Xcode Cloud sets `CI=TRUE`, which
 * `getenv`'s `boolish` rejects with an error.
 */
export function isCI(): boolean {
  const value = process.env.CI?.trim().toLowerCase();
  return !!value && !NOT_CI_VALUES.has(value);
}
