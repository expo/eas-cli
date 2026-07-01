import { CompositeFunctionConfigZ } from '@expo/eas-build-job';
import path from 'path';

import {
  buildCompositeFunctionCatalogFromStepsAsync,
  isLocalCompositeFunctionPath,
  parseLocalCompositeFunctionPath,
  resolveLocalCompositeFunctionPath,
} from '../localCompositeFunctions';

describe(isLocalCompositeFunctionPath, () => {
  it('recognizes relative paths as local composite function paths', () => {
    expect(isLocalCompositeFunctionPath('./.eas/functions/setup')).toBe(true);
    expect(isLocalCompositeFunctionPath('../../shared/actions/setup')).toBe(true);
    expect(isLocalCompositeFunctionPath('  ./.eas/functions/setup/  ')).toBe(true);
  });

  it('rejects function ids and absolute or backslash-prefixed paths', () => {
    expect(isLocalCompositeFunctionPath('eas/build')).toBe(false);
    expect(isLocalCompositeFunctionPath('/actions/setup')).toBe(false);
    expect(isLocalCompositeFunctionPath('..\\actions\\setup')).toBe(false);
  });
});

describe(parseLocalCompositeFunctionPath, () => {
  it('parses local composite function paths', () => {
    expect(parseLocalCompositeFunctionPath('./.eas/functions/setup')).toBe(
      './.eas/functions/setup'
    );
    expect(parseLocalCompositeFunctionPath('../../shared/actions/setup')).toBe(
      '../../shared/actions/setup'
    );
  });

  it('normalizes local composite function paths', () => {
    expect(parseLocalCompositeFunctionPath('  ./.eas/functions/setup/  ')).toBe(
      './.eas/functions/setup'
    );
  });

  it('collapses equivalent paths to the same canonical path', () => {
    expect(parseLocalCompositeFunctionPath('././.eas/functions/setup')).toBe(
      './.eas/functions/setup'
    );
    expect(parseLocalCompositeFunctionPath('./.eas/functions/other/../setup')).toBe('./.eas/functions/setup');
    expect(parseLocalCompositeFunctionPath('../shared/other/../compositeFunctions/setup')).toBe('../shared/actions/setup');
  });

  it('keeps the "./" prefix for under-root directories whose name starts with ".."', () => {
    expect(parseLocalCompositeFunctionPath('./..actions/setup')).toBe('./..actions/setup');
  });

  it('throws for degenerate paths with no path segment', () => {
    expect(() => parseLocalCompositeFunctionPath('./')).toThrow(
      /does not point to a composite function directory/
    );
    expect(() => parseLocalCompositeFunctionPath('  ./  ')).toThrow(
      /does not point to a composite function directory/
    );
    expect(() => parseLocalCompositeFunctionPath('../')).toThrow(
      /does not point to a composite function directory/
    );
    expect(() => parseLocalCompositeFunctionPath('./..')).toThrow(
      /does not point to a composite function directory/
    );
  });

  it('throws for backslash-based paths', () => {
    expect(() => parseLocalCompositeFunctionPath('./compositeFunctions\\setup')).toThrow(
      /must not contain backslashes/
    );
  });

  it('throws for interpolated local composite function paths', () => {
    expect(() => parseLocalCompositeFunctionPath('./.eas/functions/${{ inputs.name }}')).toThrow(
      /must not contain interpolation/
    );
  });

  it('parses local composite function paths that contain }}${{ as literal characters', () => {
    expect(parseLocalCompositeFunctionPath('./.eas/functions/weird}}${{name')).toBe(
      './.eas/functions/weird}}${{name'
    );
  });
});

describe(buildCompositeFunctionCatalogFromStepsAsync, () => {
  it('loads referenced composite functions transitively', async () => {
    const catalog = await buildCompositeFunctionCatalogFromStepsAsync({
      rootSteps: [{ uses: './.eas/functions/outer', id: 'outer' }],
      loadCompositeFunction: async compositeFunctionPath => {
        if (compositeFunctionPath === './.eas/functions/outer') {
          return CompositeFunctionConfigZ.parse({
            runs: { steps: [{ uses: './.eas/functions/inner' }] },
          });
        }
        if (compositeFunctionPath === './.eas/functions/inner') {
          return CompositeFunctionConfigZ.parse({
            runs: { steps: [{ run: 'echo inner' }] },
          });
        }
        throw new Error(`missing ${compositeFunctionPath}`);
      },
    });

    expect(Object.keys(catalog).sort()).toEqual([
      './.eas/functions/inner',
      './.eas/functions/outer',
    ]);
  });

  it('loads each action once even when references are cyclic (cycles are reported at expansion time)', async () => {
    const catalog = await buildCompositeFunctionCatalogFromStepsAsync({
      rootSteps: [{ uses: './.eas/functions/a', id: 'a' }],
      loadCompositeFunction: async compositeFunctionPath => {
        if (compositeFunctionPath === './.eas/functions/a') {
          return CompositeFunctionConfigZ.parse({
            runs: { steps: [{ uses: './.eas/functions/b' }] },
          });
        }
        if (compositeFunctionPath === './.eas/functions/b') {
          return CompositeFunctionConfigZ.parse({
            runs: { steps: [{ uses: './.eas/functions/a' }] },
          });
        }
        throw new Error(`missing ${compositeFunctionPath}`);
      },
    });

    expect(Object.keys(catalog).sort()).toEqual(['./.eas/functions/a', './.eas/functions/b']);
  });

  it('allows action chains of length 10 at catalog build time', async () => {
    const chainLength = 10;
    const paths = Array.from({ length: chainLength }, (_, index) => `./.eas/functions/a${index}`);

    const catalog = await buildCompositeFunctionCatalogFromStepsAsync({
      rootSteps: [{ uses: paths[0], id: 'root' }],
      loadCompositeFunction: async compositeFunctionPath => {
        const index = paths.indexOf(compositeFunctionPath);
        if (index === -1) {
          throw new Error(`missing ${compositeFunctionPath}`);
        }
        if (index === chainLength - 1) {
          return CompositeFunctionConfigZ.parse({ runs: { steps: [{ run: 'echo leaf' }] } });
        }
        return CompositeFunctionConfigZ.parse({
          runs: { steps: [{ uses: paths[index + 1] }] },
        });
      },
    });

    expect(Object.keys(catalog).sort()).toEqual(paths.sort());
  });

  it('collects normalized action paths from steps', async () => {
    const loadedPaths: string[] = [];
    await buildCompositeFunctionCatalogFromStepsAsync({
      rootSteps: [{ uses: './.eas/functions/setup/' }, { uses: 'eas/build' }, { run: 'echo hi' }],
      loadCompositeFunction: async compositeFunctionPath => {
        loadedPaths.push(compositeFunctionPath);
        return CompositeFunctionConfigZ.parse({ runs: { steps: [{ run: 'echo setup' }] } });
      },
    });
    expect(loadedPaths).toEqual(['./.eas/functions/setup']);
  });

  it('rejects interpolated local composite function paths', async () => {
    await expect(
      buildCompositeFunctionCatalogFromStepsAsync({
        rootSteps: [{ uses: './.eas/functions/${{ inputs.name }}' }],
        loadCompositeFunction: async () =>
          CompositeFunctionConfigZ.parse({ runs: { steps: [{ run: 'echo setup' }] } }),
      })
    ).rejects.toThrow(/must not contain interpolation/);
  });

  it('rejects working_directory on a root step that calls a local composite function', async () => {
    await expect(
      buildCompositeFunctionCatalogFromStepsAsync({
        rootSteps: [{ uses: './.eas/functions/setup', working_directory: 'packages/app' }],
        loadCompositeFunction: async () =>
          CompositeFunctionConfigZ.parse({ runs: { steps: [{ run: 'echo setup' }] } }),
      })
    ).rejects.toThrow(/"working_directory" is not supported on a step that calls/);
  });

  it('rejects working_directory on a nested step that calls a local composite function', async () => {
    await expect(
      buildCompositeFunctionCatalogFromStepsAsync({
        rootSteps: [{ uses: './.eas/functions/outer' }],
        loadCompositeFunction: async compositeFunctionPath => {
          if (compositeFunctionPath === './.eas/functions/outer') {
            return CompositeFunctionConfigZ.parse({
              runs: {
                steps: [{ uses: './.eas/functions/inner', working_directory: 'packages/app' }],
              },
            });
          }
          return CompositeFunctionConfigZ.parse({ runs: { steps: [{ run: 'echo inner' }] } });
        },
      })
    ).rejects.toThrow(/"working_directory" is not supported on a step that calls/);
  });

  it('allows working_directory on a step that calls a function, not a local composite function', async () => {
    const catalog = await buildCompositeFunctionCatalogFromStepsAsync({
      rootSteps: [{ uses: 'eas/build', working_directory: 'packages/app' }],
      loadCompositeFunction: async () =>
        CompositeFunctionConfigZ.parse({ runs: { steps: [{ run: 'echo setup' }] } }),
    });
    expect(Object.keys(catalog)).toEqual([]);
  });
});

describe(resolveLocalCompositeFunctionPath, () => {
  const projectRoot = path.resolve('/tmp/project');

  it('resolves a path under the conventional .eas/functions directory', () => {
    expect(resolveLocalCompositeFunctionPath(projectRoot, './.eas/functions/setup')).toBe(
      path.join(projectRoot, '.eas', 'actions', 'setup')
    );
  });

  it('resolves an arbitrary arbitrary path style path within the project', () => {
    expect(resolveLocalCompositeFunctionPath(projectRoot, './internal-actions/deploy')).toBe(
      path.join(projectRoot, 'internal-actions', 'deploy')
    );
  });

  it('resolves a composite function above the EAS project root', () => {
    expect(resolveLocalCompositeFunctionPath(projectRoot, '../shared-actions/deploy')).toBe(
      path.resolve(projectRoot, '../shared-actions/deploy')
    );
  });
});
