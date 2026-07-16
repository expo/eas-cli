/**
 * Single source of hook anchor names.
 *
 * An anchor is a named moment in a job that `before_<anchor>` / `after_<anchor>`
 * hook keys attach to. Which job types expose which keys is declared on the EAS
 * servers (per-job key lists), not here: anchor existence (this registry)
 * ≠ binding (self-declared by the carrier) ≠ availability (per-job key lists).
 *
 * Binding is self-declared by the anchor's carrier: EAS-generated steps carry
 * an internal `__hook_id` stamp, and EAS build functions declare `__hookId` on
 * their definition (any step invoking a declaring function — directly, or
 * inside a function-group expansion — is an occurrence of the anchor). Several
 * steps and several functions may declare the same anchor.
 */
export const HOOK_ANCHORS = [
  'install_node_modules',
  'submit',
  'maestro_tests',
  'maestro_cloud',
  'checkout',
] as const;

export type HookAnchorId = (typeof HOOK_ANCHORS)[number];
export type HookKey = `before_${HookAnchorId}` | `after_${HookAnchorId}`;

export const HOOK_KEYS: readonly HookKey[] = HOOK_ANCHORS.flatMap((anchor): HookKey[] => [
  `before_${anchor}`,
  `after_${anchor}`,
]);

export function isHookAnchorId(value: string): value is HookAnchorId {
  return HOOK_ANCHORS.some(anchor => anchor === value);
}

export function parseHookKey(
  key: string
): { side: 'before' | 'after'; anchorId: HookAnchorId } | null {
  const match = key.match(/^(before|after)_(.+)$/);
  if (!match) {
    return null;
  }
  const [, side, anchorId] = match;
  if (!isHookAnchorId(anchorId)) {
    return null;
  }
  return { side: side as 'before' | 'after', anchorId };
}
