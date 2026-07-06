/**
 * Single source of hook anchor names and their anchor↔function bindings.
 *
 * An anchor is a named moment in a job that `before_<anchor>` / `after_<anchor>`
 * hook keys attach to. Which job types expose which keys is declared on the EAS
 * servers (per-job key lists), not here: anchor existence (this registry)
 * ≠ binding (functionId / step stamps / native wrapper call site)
 * ≠ availability (per-job key lists).
 *
 * `functionId` binds an anchor to an EAS build function: any step invoking that
 * function (directly, or inside a function-group expansion) is an occurrence of
 * the anchor. Anchors without a functionId are bound via internal stamp fields
 * on EAS-generated shell steps (`__hook_id` / `__hook_before_id` /
 * `__hook_after_id` on the step schema).
 */
export const HOOK_ANCHORS = {
  install_node_modules: {
    description: 'The step that installs node modules.',
    functionId: 'eas/install_node_modules',
  },
  submit: {
    description: 'The step that submits the application binary to the store.',
    functionId: 'eas/upload_to_asc',
  },
  maestro_tests: {
    description: 'The step that runs Maestro tests.',
    functionId: 'eas/maestro_tests',
  },
  maestro_cloud: {
    description: 'The steps that upload to Maestro Cloud and gather its results.',
  },
  checkout: {
    description: 'The step that checks out the project sources.',
    functionId: 'eas/checkout',
  },
} as const satisfies Record<string, { description: string; functionId?: string }>;

export type HookAnchorId = keyof typeof HOOK_ANCHORS;
export type HookKey = `before_${HookAnchorId}` | `after_${HookAnchorId}`;

export function isHookAnchorId(value: string): value is HookAnchorId {
  // Own-property check: `in` would also match Object prototype names
  // ("toString", "__proto__", …), breaking the unknown-anchors-are-inert rule.
  return Object.hasOwn(HOOK_ANCHORS, value);
}

// Null prototype for the same reason: lookups of prototype property names must
// return undefined, not inherited functions.
const anchorIdByFunctionId: Record<string, HookAnchorId> = Object.create(null);
for (const [anchorId, entry] of Object.entries(HOOK_ANCHORS) as [
  HookAnchorId,
  { functionId?: string },
][]) {
  if (entry.functionId !== undefined) {
    anchorIdByFunctionId[entry.functionId] = anchorId;
  }
}
export const HOOK_ANCHOR_ID_BY_FUNCTION_ID: Readonly<Record<string, HookAnchorId>> =
  anchorIdByFunctionId;

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
