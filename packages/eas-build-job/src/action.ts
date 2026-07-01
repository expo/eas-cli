/**
 * Schema and utilities for composite actions, reusable step groups referenced via
 * `uses:` in EAS workflows (`.eas/workflows/*.yml`), or inline job step definitions.
 *
 * Local actions live under `<project-root>/.eas/actions/<name>/action.yml` and are
 * referenced as `uses: ./.eas/actions/<name>`. They are not supported in
 * `.eas/build/*.yml` custom build config files.
 */
import { promises as fs } from 'fs';
import path from 'path';
import { z } from 'zod';

import { StepZ } from './step';

const ActionInputValueTypeNameZ = z.enum(['string', 'boolean', 'number', 'json']);

const ActionInputValueZ = z.union([
  z.string(),
  z.boolean(),
  z.number(),
  z.array(z.unknown()),
  z.record(z.string(), z.unknown()),
]);

const ActionInputZ = z.union([
  z
    .string()
    .describe('Shorthand for an input name with default type "string" and no default value.'),
  z
    .object({
      name: z.string(),
      type: ActionInputValueTypeNameZ.default('string'),
      default_value: ActionInputValueZ.optional(),
      allowed_values: z.array(ActionInputValueZ).optional(),
      required: z.boolean().optional(),
    })
    .strict(),
]);

const ActionOutputZ = z
  .object({
    description: z.string().optional(),
    /**
     * @example
     * value: '${{ steps.read.outputs.version }}'
     */
    value: z.string().describe('Expression that resolves to the output value.'),
  })
  .strict();

export const ActionConfigZ = z
  .object({
    /**
     * @example
     * name: Setup
     */
    name: z.string().optional().describe('Display name of the action.'),
    description: z.string().optional(),
    /**
     * @example
     * inputs:
     *   - greeting
     *   - name: platform
     *     type: string
     *     default_value: ios
     */
    inputs: z.array(ActionInputZ).optional().describe('Inputs accepted by the action.'),
    /**
     * @example
     * outputs:
     *   version:
     *     value: '${{ steps.read.outputs.version }}'
     */
    outputs: z
      .record(z.string(), ActionOutputZ)
      .optional()
      .describe('Named outputs exposed by the action to its caller.'),
    runs: z.object({
      /**
       * @example
       * runs:
       *   steps:
       *     - id: read
       *       run: set-output version "1.0.0"
       */
      steps: z
        .array(StepZ)
        .min(1, { message: 'An action must declare at least one step under "runs.steps".' })
        .describe('Steps executed when the action is invoked.'),
    }),
  })
  .strict();

/**
 * Structure of an action configuration file (`action.yml`).
 *
 * @example
 * name: Setup
 * inputs:
 *   - greeting
 * outputs:
 *   version:
 *     value: '${{ steps.read.outputs.version }}'
 * runs:
 *   steps:
 *     - id: read
 *       run: set-output version "1.0.0"
 */
export type ActionConfig = z.infer<typeof ActionConfigZ>;

export type ActionInputConfig = z.infer<typeof ActionInputZ>;

export type ActionOutputConfig = z.infer<typeof ActionOutputZ>;

export type ActionCatalog = Record<string, ActionConfig>;

export type LocalActionReference = {
  kind: 'local';
  ref: string;
};

export type RemoteActionReference = {
  kind: 'remote';
  ref: string;
};

export type ActionReference = LocalActionReference | RemoteActionReference;

export type ActionLoader = (ref: string) => Promise<ActionConfig>;

export type BuildActionCatalogFromStepsOptions = {
  rootSteps: readonly unknown[];
  loadAction: ActionLoader;
  onActionLoaded?: (ref: string, config: ActionConfig) => void;
  onCycleDetected?: (cyclePath: string[]) => Error;
};

export function validateActionConfig(
  maybeConfig: unknown,
  { actionReference }: { actionReference?: string } = {}
): ActionConfig {
  const result = ActionConfigZ.safeParse(maybeConfig);
  if (!result.success) {
    const issues = result.error.issues
      .map(issue => {
        const path = issue.path.join('.');
        return path.length > 0 ? `${path}: ${issue.message}` : issue.message;
      })
      .join('; ');
    const prefix = actionReference
      ? `Invalid action "${actionReference}": `
      : 'Invalid action configuration: ';
    throw new Error(`${prefix}${issues}`);
  }
  return result.data;
}

export function normalizeActionReference(uses: string): string {
  let ref = uses.trim();
  while (ref.length > 1 && ref.endsWith('/')) {
    ref = ref.slice(0, -1);
  }
  return ref;
}

export function parseActionReference(uses: string): ActionReference | null {
  const trimmed = uses.trim();
  if (trimmed.startsWith('./')) {
    return { kind: 'local', ref: normalizeActionReference(trimmed) };
  }
  return null;
}

export function isActionReference(uses: string): boolean {
  return parseActionReference(uses) !== null;
}

export function isLocalActionReference(uses: string): boolean {
  return parseActionReference(uses)?.kind === 'local';
}

export function getActionNotFoundError(
  ref: string,
  kind: ActionReference['kind'] = 'local'
): string {
  if (kind === 'local') {
    return `Local action "${ref}" was referenced by a step but no such action exists. Local actions must live under ".eas/actions/<name>" and be referenced as "uses: ${ref}".`;
  }
  return `Action "${ref}" was referenced by a step but no such action exists.`;
}

export function getActionCycleError(cyclePath: string[]): string {
  return `Detected a cycle while expanding actions: ${cyclePath.join(' -> ')}. An action cannot reference itself, directly or indirectly.`;
}

export function getWorkflowLocalActionsMissingError(missingRefs: string[]): string {
  return `The workflow references local actions that do not exist: ${missingRefs
    .map(ref => `"${ref}"`)
    .join(
      ', '
    )}. Local actions must live under "<project-root>/.eas/actions/<name>/action.yml" in the EAS project directory (the directory containing eas.json, e.g. "apps/mobile" in a monorepo) and be referenced as "uses: ./.eas/actions/<name>".`;
}

export function getWorkflowLocalActionsCycleError(cyclePath: string[]): string {
  return `The workflow references local actions that form a cycle: ${cyclePath.join(' -> ')}. An action cannot reference itself, directly or indirectly.`;
}

export async function buildActionCatalogFromStepsAsync({
  rootSteps,
  loadAction,
  onActionLoaded,
  onCycleDetected,
}: BuildActionCatalogFromStepsOptions): Promise<ActionCatalog> {
  const catalog: ActionCatalog = {};
  const loaded = new Set<string>();

  const loadRecursive = async (ref: string, ancestry: string[]): Promise<void> => {
    if (ancestry.includes(ref)) {
      const cyclePath = [...ancestry, ref];
      throw onCycleDetected?.(cyclePath) ?? new Error(getActionCycleError(cyclePath));
    }
    if (loaded.has(ref)) {
      return;
    }

    const config = await loadAction(ref);
    catalog[ref] = config;
    loaded.add(ref);
    onActionLoaded?.(ref, config);

    for (const nestedRef of collectActionReferencesFromSteps(config.runs.steps)) {
      await loadRecursive(nestedRef, [...ancestry, ref]);
    }
  };

  for (const ref of collectActionReferencesFromSteps(rootSteps)) {
    await loadRecursive(ref, []);
  }

  return catalog;
}

export async function discoverLocalActionPathsByRefAsync(
  projectRoot: string
): Promise<Map<string, string>> {
  const actionsDir = path.join(projectRoot, '.eas', 'actions');
  const pathByRef = new Map<string, string>();

  let actionNames: string[];
  try {
    actionNames = await fs.readdir(actionsDir);
  } catch {
    return pathByRef;
  }

  for (const actionName of actionNames) {
    for (const ext of ['yml', 'yaml'] as const) {
      const relativeActionConfigPath = path.posix.join(
        '.eas',
        'actions',
        actionName,
        `action.${ext}`
      );
      const absolutePath = path.join(projectRoot, relativeActionConfigPath);
      try {
        await fs.access(absolutePath);
        const ref = normalizeActionReference(`./${path.posix.dirname(relativeActionConfigPath)}`);
        pathByRef.set(ref, absolutePath);
        break;
      } catch {}
    }
  }

  return pathByRef;
}

export function collectActionReferencesFromSteps(
  steps: readonly unknown[],
  into: Set<string> = new Set()
): Set<string> {
  for (const step of steps) {
    if (!step || typeof step !== 'object') {
      continue;
    }
    const uses = (step as { uses?: unknown }).uses;
    if (typeof uses === 'string') {
      const parsed = parseActionReference(uses);
      if (parsed) {
        into.add(parsed.ref);
      }
    }
  }
  return into;
}
