import { promises as fs } from 'fs';
import os from 'os';
import path from 'path';

import { buildActionCatalogAsync } from '../actions';

async function makeProjectWithActionAsync(actionName: string, contents: string): Promise<string> {
  const projectRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'eas-actions-test-'));
  const actionDir = path.join(projectRoot, '.eas', 'actions', actionName);
  await fs.mkdir(actionDir, { recursive: true });
  await fs.writeFile(path.join(actionDir, 'action.yml'), contents, 'utf-8');
  return projectRoot;
}

const setupActionContents = [
  'name: Setup',
  'inputs:',
  '  - name: greeting',
  '    type: string',
  '    default_value: hello',
  'outputs:',
  '  version:',
  '    value: ${{ steps.read.outputs.version }}',
  'runs:',
  '  steps:',
  '    - id: read',
  '      run: set-output version "1.0.0"',
].join('\n');

describe(buildActionCatalogAsync, () => {
  it('discovers, reads and validates referenced local actions keyed by normalized ref', async () => {
    const projectRoot = await makeProjectWithActionAsync('setup', setupActionContents);

    const catalog = await buildActionCatalogAsync(projectRoot, {
      steps: [{ uses: './.eas/actions/setup', id: 'setup' }],
    });

    expect(Object.keys(catalog)).toEqual(['./.eas/actions/setup']);
    const action = catalog['./.eas/actions/setup'];
    expect(action.name).toBe('Setup');
    expect(action.runs.steps).toHaveLength(1);
    expect(action.outputs?.version.value).toBe('${{ steps.read.outputs.version }}');
  });

  it('loads nested actions transitively referenced by other actions', async () => {
    const projectRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'eas-actions-nested-'));
    const innerDir = path.join(projectRoot, '.eas', 'actions', 'inner');
    const outerDir = path.join(projectRoot, '.eas', 'actions', 'outer');
    await fs.mkdir(innerDir, { recursive: true });
    await fs.mkdir(outerDir, { recursive: true });
    await fs.writeFile(
      path.join(innerDir, 'action.yml'),
      ['runs:', '  steps:', '    - run: echo inner'].join('\n'),
      'utf-8'
    );
    await fs.writeFile(
      path.join(outerDir, 'action.yml'),
      ['runs:', '  steps:', '    - uses: ./.eas/actions/inner'].join('\n'),
      'utf-8'
    );

    const catalog = await buildActionCatalogAsync(projectRoot, {
      steps: [{ uses: './.eas/actions/outer', id: 'outer' }],
    });

    expect(Object.keys(catalog).sort()).toEqual(['./.eas/actions/inner', './.eas/actions/outer']);
  });

  it('returns an empty catalog when there are no referenced actions', async () => {
    const projectRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'eas-actions-empty-'));
    const catalog = await buildActionCatalogAsync(projectRoot, { steps: [{ run: 'echo hi' }] });
    expect(catalog).toEqual({});
  });

  it('ignores unreferenced malformed actions on disk', async () => {
    const projectRoot = await makeProjectWithActionAsync(
      'broken',
      ['name: Broken', 'runs:', '  steps: []'].join('\n')
    );

    const catalog = await buildActionCatalogAsync(projectRoot, { steps: [{ run: 'echo hi' }] });
    expect(catalog).toEqual({});
  });

  it('throws a clear error for a referenced action that does not exist', async () => {
    const projectRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'eas-actions-missing-'));
    await expect(
      buildActionCatalogAsync(projectRoot, {
        steps: [{ uses: './.eas/actions/missing', id: 'missing' }],
      })
    ).rejects.toThrow(
      /Local action "\.\/\.eas\/actions\/missing" was referenced by a step but no such action exists/
    );
  });

  it('throws a clear error for a malformed referenced action config', async () => {
    const projectRoot = await makeProjectWithActionAsync(
      'broken',
      ['name: Broken', 'runs:', '  steps: []'].join('\n')
    );
    await expect(
      buildActionCatalogAsync(projectRoot, {
        steps: [{ uses: './.eas/actions/broken', id: 'broken' }],
      })
    ).rejects.toThrow(/must declare at least one step under "runs.steps"/);
  });
});
