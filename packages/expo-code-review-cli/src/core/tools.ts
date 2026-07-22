/** The OpenCode tool names the reviewer toggles. Single source of truth so the
 * agent and coordinator tool maps can't drift apart. */
export const TOOL_NAMES = [
  'read',
  'grep',
  'glob',
  'list',
  'bash',
  'write',
  'edit',
  'patch',
] as const;

/** Build a full tool map with only the listed tools enabled. */
export function toolMap(enabled: readonly string[]): Record<string, boolean> {
  return Object.fromEntries(TOOL_NAMES.map(name => [name, enabled.includes(name)]));
}
