// Local composite functions referenced via `uses: ./path` or `uses: ../path` in EAS workflows.
// Not supported in `.eas/build/*.yml` custom build configs.

export function isLocalCompositeFunctionPath(uses: string): boolean {
  const trimmed = uses.trim();
  return trimmed.startsWith('./') || trimmed.startsWith('../');
}
