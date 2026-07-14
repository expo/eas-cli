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
export const HOOK_ANCHORS = {
  install_node_modules: {
    description: 'The step that installs node modules.',
  },
  submit: {
    description: 'The step that submits the application binary to the store.',
  },
  maestro_tests: {
    description: 'The step that runs Maestro tests.',
  },
  maestro_cloud: {
    description: 'The steps that upload to Maestro Cloud and gather its results.',
  },
  checkout: {
    description: 'The step that checks out the project sources.',
  },
} as const satisfies Record<string, { description: string }>;

export type HookAnchorId = keyof typeof HOOK_ANCHORS;
export type HookKey = `before_${HookAnchorId}` | `after_${HookAnchorId}`;

export function isHookAnchorId(value: string): value is HookAnchorId {
  // Own-property check: `in` would also match Object prototype names
  // ("toString", "__proto__", …), breaking the unknown-anchors-are-inert rule.
  return Object.hasOwn(HOOK_ANCHORS, value);
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
