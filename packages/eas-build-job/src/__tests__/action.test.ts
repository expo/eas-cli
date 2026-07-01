import { promises as fs } from 'fs';
import os from 'os';
import path from 'path';

import {
  buildActionCatalogFromStepsAsync,
  collectActionReferencesFromSteps,
  discoverLocalActionPathsByRefAsync,
  isActionReference,
  isLocalActionReference,
  normalizeActionReference,
  parseActionReference,
  validateActionConfig,
} from '../action';

describe(validateActionConfig, () => {
  it('accepts a valid local action config', () => {
    const config = {
      name: 'Setup',
      inputs: [{ name: 'greeting', type: 'string', default_value: 'hello' }],
      outputs: { version: { value: '${{ steps.read.outputs.version }}' } },
      runs: {
        steps: [{ id: 'read', run: 'set-output version "1.0.0"' }],
      },
    };
    expect(validateActionConfig(config)).toEqual(config);
  });

  it('accepts shorthand input names', () => {
    const config = {
      inputs: ['greeting'],
      runs: {
        steps: [{ run: 'echo hello' }],
      },
    };
    expect(validateActionConfig(config)).toEqual(config);
  });

  it('errors when runs.steps is empty', () => {
    const config = {
      name: 'Broken',
      runs: { steps: [] },
    };
    expect(() => validateActionConfig(config)).toThrow(
      /must declare at least one step under "runs.steps"/
    );
  });

  it('includes actionReference in validation errors when provided', () => {
    const config = {
      name: 'Broken',
      runs: { steps: [] },
    };
    expect(() => validateActionConfig(config, { actionReference: './.eas/actions/setup' })).toThrow(
      /Invalid action "\.\/\.eas\/actions\/setup": .*must declare at least one step/
    );
  });
});

describe(parseActionReference, () => {
  it('parses local action references', () => {
    expect(parseActionReference('./.eas/actions/setup')).toEqual({
      kind: 'local',
      ref: './.eas/actions/setup',
    });
  });

  it('normalizes local action references', () => {
    expect(parseActionReference('  ./.eas/actions/setup/  ')).toEqual({
      kind: 'local',
      ref: './.eas/actions/setup',
    });
  });

  it('returns null for built-in function ids', () => {
    expect(parseActionReference('eas/build')).toBeNull();
  });
});

describe(isActionReference, () => {
  it('returns true for local action references', () => {
    expect(isActionReference('./.eas/actions/setup')).toBe(true);
  });

  it('returns false for built-in function ids', () => {
    expect(isActionReference('eas/build')).toBe(false);
  });
});

describe(isLocalActionReference, () => {
  it('returns true for "./"-prefixed action paths', () => {
    expect(isLocalActionReference('./.eas/actions/setup')).toBe(true);
  });

  it('returns false for non-./-prefixed paths', () => {
    expect(isLocalActionReference('../actions/setup')).toBe(false);
  });

  it('returns false for built-in function ids', () => {
    expect(isLocalActionReference('eas/build')).toBe(false);
  });

  it('ignores surrounding whitespace, matching normalizeActionReference', () => {
    expect(isLocalActionReference('  ./.eas/actions/setup  ')).toBe(true);
  });
});

describe(normalizeActionReference, () => {
  it('trims trailing slashes', () => {
    expect(normalizeActionReference('./.eas/actions/setup/')).toBe('./.eas/actions/setup');
  });

  it('trims multiple trailing slashes', () => {
    expect(normalizeActionReference('./.eas/actions/setup///')).toBe('./.eas/actions/setup');
  });

  it('trims surrounding whitespace', () => {
    expect(normalizeActionReference('  ./.eas/actions/setup/  ')).toBe('./.eas/actions/setup');
  });
});

describe(collectActionReferencesFromSteps, () => {
  it('collects normalized action references from steps', () => {
    const refs = collectActionReferencesFromSteps([
      { uses: './.eas/actions/setup/' },
      { uses: 'eas/build' },
      { run: 'echo hi' },
    ]);
    expect([...refs]).toEqual(['./.eas/actions/setup']);
  });
});

describe(buildActionCatalogFromStepsAsync, () => {
  it('loads referenced actions transitively', async () => {
    const catalog = await buildActionCatalogFromStepsAsync({
      rootSteps: [{ uses: './.eas/actions/outer', id: 'outer' }],
      loadAction: async ref => {
        if (ref === './.eas/actions/outer') {
          return validateActionConfig({
            runs: { steps: [{ uses: './.eas/actions/inner' }] },
          });
        }
        if (ref === './.eas/actions/inner') {
          return validateActionConfig({
            runs: { steps: [{ run: 'echo inner' }] },
          });
        }
        throw new Error(`missing ${ref}`);
      },
    });

    expect(Object.keys(catalog).sort()).toEqual(['./.eas/actions/inner', './.eas/actions/outer']);
  });

  it('detects cycles while loading', async () => {
    await expect(
      buildActionCatalogFromStepsAsync({
        rootSteps: [{ uses: './.eas/actions/a', id: 'a' }],
        loadAction: async ref => {
          if (ref === './.eas/actions/a') {
            return validateActionConfig({
              runs: { steps: [{ uses: './.eas/actions/b' }] },
            });
          }
          if (ref === './.eas/actions/b') {
            return validateActionConfig({
              runs: { steps: [{ uses: './.eas/actions/a' }] },
            });
          }
          throw new Error(`missing ${ref}`);
        },
      })
    ).rejects.toThrow(/cycle/i);
  });
});

describe(discoverLocalActionPathsByRefAsync, () => {
  it('discovers local actions under .eas/actions', async () => {
    const projectRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'eas-local-action-discover-'));
    const actionDir = path.join(projectRoot, '.eas', 'actions', 'setup');
    await fs.mkdir(actionDir, { recursive: true });
    await fs.writeFile(path.join(actionDir, 'action.yml'), 'runs:\n  steps:\n    - run: echo hi\n');

    const pathByRef = await discoverLocalActionPathsByRefAsync(projectRoot);

    expect([...pathByRef.keys()]).toEqual(['./.eas/actions/setup']);
    expect(pathByRef.get('./.eas/actions/setup')).toBe(path.join(actionDir, 'action.yml'));
  });

  it('returns an empty map when .eas/actions is missing', async () => {
    const projectRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'eas-local-action-discover-'));

    const pathByRef = await discoverLocalActionPathsByRefAsync(projectRoot);

    expect(pathByRef).toEqual(new Map());
  });

  it('prefers action.yml over action.yaml when both exist', async () => {
    const projectRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'eas-local-action-discover-'));
    const actionDir = path.join(projectRoot, '.eas', 'actions', 'setup');
    await fs.mkdir(actionDir, { recursive: true });
    await fs.writeFile(
      path.join(actionDir, 'action.yml'),
      'runs:\n  steps:\n    - run: echo yml\n'
    );
    await fs.writeFile(
      path.join(actionDir, 'action.yaml'),
      'runs:\n  steps:\n    - run: echo yaml\n'
    );

    const pathByRef = await discoverLocalActionPathsByRefAsync(projectRoot);

    expect(pathByRef.get('./.eas/actions/setup')).toBe(path.join(actionDir, 'action.yml'));
  });
});
