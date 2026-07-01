import { promises as fs } from 'fs';
import os from 'os';
import path from 'path';

import { buildCompositeFunctionCatalogAsync } from '../compositeFunctions';

async function makeProjectWithCompositeFunctionAsync(
  functionName: string,
  contents: string
): Promise<string> {
  const projectRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'eas-functions-test-'));
  const functionDir = path.join(projectRoot, '.eas', 'actions', functionName);
  await fs.mkdir(functionDir, { recursive: true });
  await fs.writeFile(path.join(functionDir, 'function.yml'), contents, 'utf-8');
  return projectRoot;
}

const setupCompositeFunctionContents = [
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

describe(buildCompositeFunctionCatalogAsync, () => {
  it('discovers, reads and validates referenced local composite functions keyed by normalized ref', async () => {
    const projectRoot = await makeProjectWithCompositeFunctionAsync(
      'setup',
      setupCompositeFunctionContents
    );

    const catalog = await buildCompositeFunctionCatalogAsync(projectRoot, {
      steps: [{ uses: './.eas/functions/setup', id: 'setup' }],
    });

    expect(Object.keys(catalog)).toEqual(['./.eas/functions/setup']);
    const action = catalog['./.eas/functions/setup'];
    expect(action.name).toBe('Setup');
    expect(action.runs.steps).toHaveLength(1);
    expect(action.outputs?.version.value).toBe('${{ steps.read.outputs.version }}');
  });

  it('loads nested composite functions transitively referenced by other actions', async () => {
    const projectRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'eas-functions-nested-'));
    const innerDir = path.join(projectRoot, '.eas', 'actions', 'inner');
    const outerDir = path.join(projectRoot, '.eas', 'actions', 'outer');
    await fs.mkdir(innerDir, { recursive: true });
    await fs.mkdir(outerDir, { recursive: true });
    await fs.writeFile(
      path.join(innerDir, 'function.yml'),
      ['runs:', '  steps:', '    - run: echo inner'].join('\n'),
      'utf-8'
    );
    await fs.writeFile(
      path.join(outerDir, 'function.yml'),
      ['runs:', '  steps:', '    - uses: ./.eas/functions/inner'].join('\n'),
      'utf-8'
    );

    const catalog = await buildCompositeFunctionCatalogAsync(projectRoot, {
      steps: [{ uses: './.eas/functions/outer', id: 'outer' }],
    });

    expect(Object.keys(catalog).sort()).toEqual([
      './.eas/functions/inner',
      './.eas/functions/outer',
    ]);
  });

  it('returns an empty catalog when there are no referenced composite functions', async () => {
    const projectRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'eas-functions-empty-'));
    const catalog = await buildCompositeFunctionCatalogAsync(projectRoot, {
      steps: [{ run: 'echo hi' }],
    });
    expect(catalog).toEqual({});
  });

  it('ignores unreferenced malformed composite functions on disk', async () => {
    const projectRoot = await makeProjectWithCompositeFunctionAsync(
      'broken',
      ['name: Broken', 'runs:', '  steps: []'].join('\n')
    );

    const catalog = await buildCompositeFunctionCatalogAsync(projectRoot, {
      steps: [{ run: 'echo hi' }],
    });
    expect(catalog).toEqual({});
  });

  it('resolves actions referenced by an arbitrary path (arbitrary path style)', async () => {
    const projectRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'eas-functions-arbitrary-'));
    const functionDir = path.join(projectRoot, 'internal-actions', 'deploy');
    await fs.mkdir(functionDir, { recursive: true });
    await fs.writeFile(
      path.join(functionDir, 'function.yml'),
      ['runs:', '  steps:', '    - run: echo deploy'].join('\n'),
      'utf-8'
    );

    const catalog = await buildCompositeFunctionCatalogAsync(projectRoot, {
      steps: [{ uses: './internal-actions/deploy', id: 'deploy' }],
    });

    expect(Object.keys(catalog)).toEqual(['./internal-actions/deploy']);
  });

  it('resolves actions defined with an function.yaml extension', async () => {
    const projectRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'eas-functions-yaml-'));
    const functionDir = path.join(projectRoot, '.eas', 'actions', 'setup');
    await fs.mkdir(functionDir, { recursive: true });
    await fs.writeFile(
      path.join(functionDir, 'function.yaml'),
      ['runs:', '  steps:', '    - run: echo hi'].join('\n'),
      'utf-8'
    );

    const catalog = await buildCompositeFunctionCatalogAsync(projectRoot, {
      steps: [{ uses: './.eas/functions/setup', id: 'setup' }],
    });

    expect(Object.keys(catalog)).toEqual(['./.eas/functions/setup']);
  });

  it('loads a shared composite function above the EAS project root', async () => {
    const sourceRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'eas-functions-monorepo-'));
    const projectRoot = path.join(sourceRoot, 'apps', 'my-app');
    const functionDir = path.join(sourceRoot, 'shared', 'actions', 'setup');
    await fs.mkdir(projectRoot, { recursive: true });
    await fs.mkdir(functionDir, { recursive: true });
    await fs.writeFile(
      path.join(functionDir, 'function.yml'),
      ['runs:', '  steps:', '    - run: echo shared'].join('\n'),
      'utf-8'
    );

    const catalog = await buildCompositeFunctionCatalogAsync(projectRoot, {
      steps: [{ uses: '../../shared/actions/setup', id: 'setup' }],
    });

    expect(Object.keys(catalog)).toEqual(['../../shared/actions/setup']);
  });

  it('throws a clear error for a referenced action that does not exist', async () => {
    const projectRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'eas-functions-missing-'));
    await expect(
      buildCompositeFunctionCatalogAsync(projectRoot, {
        steps: [{ uses: './.eas/functions/missing', id: 'missing' }],
      })
    ).rejects.toThrow(
      /Local composite function "\.\/\.eas\/actions\/missing" was referenced by a step but no such composite function exists/
    );
  });

  it('throws a clear error for a malformed referenced action config', async () => {
    const projectRoot = await makeProjectWithCompositeFunctionAsync(
      'broken',
      ['name: Broken', 'runs:', '  steps: []'].join('\n')
    );
    await expect(
      buildCompositeFunctionCatalogAsync(projectRoot, {
        steps: [{ uses: './.eas/functions/broken', id: 'broken' }],
      })
    ).rejects.toThrow(/must declare at least one step under "runs.steps"/);
  });
});
