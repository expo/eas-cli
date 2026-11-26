/**
 * Whether the CLI runs in CI. `CI` counts unless it is empty, `false` or `0`, in any case.
 * CI providers set it to different values, e.g. Xcode Cloud sets `CI=TRUE`, which
 * `getenv`'s `boolish` rejects with an error.
 */
export function isCI(): boolean {
  const value = process.env.CI?.trim().toLowerCase();
  return !!value && value !== 'false' && value !== '0';
}
