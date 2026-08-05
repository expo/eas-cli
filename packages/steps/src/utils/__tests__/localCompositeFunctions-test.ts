import { CompositeFunctionConfigZ } from '@expo/eas-build-job';
import fs from 'fs/promises';
import os from 'os';
import path from 'path';

import {
  buildLocalFunctionCatalogAsync,
  buildLocalFunctionCatalogFromStepsAsync,
  createLocalFunctionLoader,
  extendLocalFunctionCatalogFromStepsAsync,
  isLocalFunctionPath,
  loadLocalFunctionConfigAsync,
  parseLocalFunctionPath,
  resolveLocalFunctionPath,
} from '../localCompositeFunctions';

async function makeCompositeFunctionAsync(
  projectRoot: string,
  functionName: string,
  contents: string,
  { fileName = 'function.yml' }: { fileName?: string } = {}
): Promise<void> {
  const functionDir = path.join(projectRoot, '.eas', 'functions', functionName);
  await fs.mkdir(functionDir, { recursive: true });
  await fs.writeFile(path.join(functionDir, fileName), contents, 'utf-8');
}

describe(isLocalFunctionPath, () => {
  it('recognizes relative paths as local composite function paths', () => {
    expect(isLocalFunctionPath('./.eas/functions/setup')).toBe(true);
    expect(isLocalFunctionPath('../../shared/actions/setup')).toBe(true);
    expect(isLocalFunctionPath('  ./.eas/functions/setup/  ')).toBe(true);
  });

  it('rejects function ids and absolute or backslash-prefixed paths', () => {
    expect(isLocalFunctionPath('eas/build')).toBe(false);
    expect(isLocalFunctionPath('/actions/setup')).toBe(false);
    expect(isLocalFunctionPath('..\\actions\\setup')).toBe(false);
  });
});

describe(parseLocalFunctionPath, () => {
  it('parses local composite function paths', () => {
    expect(parseLocalFunctionPath('./.eas/functions/setup')).toBe('./.eas/functions/setup');
    expect(parseLocalFunctionPath('../../shared/actions/setup')).toBe('../../shared/actions/setup');
  });

  it('normalizes local composite function paths', () => {
    expect(parseLocalFunctionPath('  ./.eas/functions/setup/  ')).toBe('./.eas/functions/setup');
  });

  it('collapses equivalent paths to the same canonical path', () => {
    expect(parseLocalFunctionPath('././.eas/functions/setup')).toBe('./.eas/functions/setup');
    expect(parseLocalFunctionPath('./.eas/functions/other/../setup')).toBe(
      './.eas/functions/setup'
    );
    expect(parseLocalFunctionPath('../shared/other/../functions/setup')).toBe(
      '../shared/functions/setup'
    );
  });

  it('keeps the "./" prefix for under-root directories whose name starts with ".."', () => {
    expect(parseLocalFunctionPath('./..actions/setup')).toBe('./..actions/setup');
  });

  it('canonicalizes paths pointing at the project root or its parent', () => {
    expect(parseLocalFunctionPath('./')).toBe('./.');
    expect(parseLocalFunctionPath('  ./  ')).toBe('./.');
    expect(parseLocalFunctionPath('../')).toBe('..');
    expect(parseLocalFunctionPath('./..')).toBe('..');
  });

  it('is stable when re-parsing its own canonical output', () => {
    expect(parseLocalFunctionPath('./.')).toBe('./.');
    expect(parseLocalFunctionPath('../.')).toBe('..');
  });

  it('throws for backslash-based paths', () => {
    expect(() => parseLocalFunctionPath('./compositeFunctions\\setup')).toThrow(
      /must not contain backslashes/
    );
  });

  it('throws for interpolated local composite function paths', () => {
    expect(() => parseLocalFunctionPath('./.eas/functions/${{ inputs.name }}')).toThrow(
      /must not contain interpolation/
    );
  });

  it('parses local composite function paths that contain }}${{ as literal characters', () => {
    expect(parseLocalFunctionPath('./.eas/functions/weird}}${{name')).toBe(
      './.eas/functions/weird}}${{name'
    );
  });
});

describe(buildLocalFunctionCatalogFromStepsAsync, () => {
  it('loads referenced composite functions transitively', async () => {
    const catalog = await buildLocalFunctionCatalogFromStepsAsync({
      rootSteps: [{ uses: './.eas/functions/outer', id: 'outer' }],
      loadLocalFunction: async compositeFunctionPath => {
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
    const catalog = await buildLocalFunctionCatalogFromStepsAsync({
      rootSteps: [{ uses: './.eas/functions/a', id: 'a' }],
      loadLocalFunction: async compositeFunctionPath => {
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

    const catalog = await buildLocalFunctionCatalogFromStepsAsync({
      rootSteps: [{ uses: paths[0], id: 'root' }],
      loadLocalFunction: async compositeFunctionPath => {
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
    await buildLocalFunctionCatalogFromStepsAsync({
      rootSteps: [{ uses: './.eas/functions/setup/' }, { uses: 'eas/build' }, { run: 'echo hi' }],
      loadLocalFunction: async compositeFunctionPath => {
        loadedPaths.push(compositeFunctionPath);
        return CompositeFunctionConfigZ.parse({ runs: { steps: [{ run: 'echo setup' }] } });
      },
    });
    expect(loadedPaths).toEqual(['./.eas/functions/setup']);
  });

  it('rejects interpolated local composite function paths', async () => {
    await expect(
      buildLocalFunctionCatalogFromStepsAsync({
        rootSteps: [{ uses: './.eas/functions/${{ inputs.name }}' }],
        loadLocalFunction: async () =>
          CompositeFunctionConfigZ.parse({ runs: { steps: [{ run: 'echo setup' }] } }),
      })
    ).rejects.toThrow(/must not contain interpolation/);
  });

  it('rejects working_directory on a root step that calls a local composite function', async () => {
    await expect(
      buildLocalFunctionCatalogFromStepsAsync({
        rootSteps: [{ uses: './.eas/functions/setup', working_directory: 'packages/app' }],
        loadLocalFunction: async () =>
          CompositeFunctionConfigZ.parse({ runs: { steps: [{ run: 'echo setup' }] } }),
      })
    ).rejects.toThrow(/"working_directory" is not supported on a step that calls/);
  });

  it('rejects working_directory on a nested step that calls a local composite function', async () => {
    await expect(
      buildLocalFunctionCatalogFromStepsAsync({
        rootSteps: [{ uses: './.eas/functions/outer' }],
        loadLocalFunction: async compositeFunctionPath => {
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
    const catalog = await buildLocalFunctionCatalogFromStepsAsync({
      rootSteps: [{ uses: 'eas/build', working_directory: 'packages/app' }],
      loadLocalFunction: async () =>
        CompositeFunctionConfigZ.parse({ runs: { steps: [{ run: 'echo setup' }] } }),
    });
    expect(Object.keys(catalog)).toEqual([]);
  });
});

describe(extendLocalFunctionCatalogFromStepsAsync, () => {
  it('extends the given catalog in place', async () => {
    const catalog = {
      './.eas/functions/existing': CompositeFunctionConfigZ.parse({
        runs: { steps: [{ run: 'echo existing' }] },
      }),
    };
    await extendLocalFunctionCatalogFromStepsAsync({
      catalog,
      rootSteps: [{ uses: './.eas/functions/setup' }],
      loadLocalFunction: async () =>
        CompositeFunctionConfigZ.parse({ runs: { steps: [{ run: 'echo setup' }] } }),
    });
    expect(Object.keys(catalog).sort()).toEqual([
      './.eas/functions/existing',
      './.eas/functions/setup',
    ]);
  });

  it('skips paths already present without calling the loader', async () => {
    const loadedPaths: string[] = [];
    const catalog = {
      './.eas/functions/setup': CompositeFunctionConfigZ.parse({
        runs: { steps: [{ run: 'echo setup' }] },
      }),
    };
    await extendLocalFunctionCatalogFromStepsAsync({
      catalog,
      rootSteps: [{ uses: './.eas/functions/setup' }],
      loadLocalFunction: async compositeFunctionPath => {
        loadedPaths.push(compositeFunctionPath);
        throw new Error(`must not be called: ${compositeFunctionPath}`);
      },
    });
    expect(loadedPaths).toEqual([]);
    expect(Object.keys(catalog)).toEqual(['./.eas/functions/setup']);
  });

  it('recurses into nested references', async () => {
    const catalog = {};
    await extendLocalFunctionCatalogFromStepsAsync({
      catalog,
      rootSteps: [{ uses: './.eas/functions/outer' }],
      loadLocalFunction: async compositeFunctionPath => {
        if (compositeFunctionPath === './.eas/functions/outer') {
          return CompositeFunctionConfigZ.parse({
            runs: { steps: [{ uses: './.eas/functions/inner' }] },
          });
        }
        return CompositeFunctionConfigZ.parse({ runs: { steps: [{ run: 'echo inner' }] } });
      },
    });
    expect(Object.keys(catalog).sort()).toEqual([
      './.eas/functions/inner',
      './.eas/functions/outer',
    ]);
  });
});

describe(resolveLocalFunctionPath, () => {
  const projectRoot = path.resolve('/tmp/project');

  it('resolves a path under the conventional .eas/functions directory', () => {
    expect(resolveLocalFunctionPath(projectRoot, './.eas/functions/setup')).toBe(
      path.join(projectRoot, '.eas', 'functions', 'setup')
    );
  });

  it('resolves an arbitrary arbitrary path style path within the project', () => {
    expect(resolveLocalFunctionPath(projectRoot, './internal-actions/deploy')).toBe(
      path.join(projectRoot, 'internal-actions', 'deploy')
    );
  });

  it('resolves a composite function above the EAS project root', () => {
    expect(resolveLocalFunctionPath(projectRoot, '../shared-actions/deploy')).toBe(
      path.resolve(projectRoot, '../shared-actions/deploy')
    );
  });
});

describe(loadLocalFunctionConfigAsync, () => {
  it('loads and validates a function.yml file', async () => {
    const projectRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'steps-functions-test-'));
    await makeCompositeFunctionAsync(
      projectRoot,
      'setup',
      ['name: Setup', 'runs:', '  steps:', '    - run: echo setup'].join('\n')
    );

    const config = await loadLocalFunctionConfigAsync(projectRoot, './.eas/functions/setup');

    expect(config.name).toBe('Setup');
    expect(config.runs.steps).toHaveLength(1);
  });

  it('loads a function.yaml file when function.yml is absent', async () => {
    const projectRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'steps-functions-test-'));
    await makeCompositeFunctionAsync(
      projectRoot,
      'setup',
      ['runs:', '  steps:', '    - run: echo setup'].join('\n'),
      { fileName: 'function.yaml' }
    );

    const config = await loadLocalFunctionConfigAsync(projectRoot, './.eas/functions/setup');

    expect(config.runs.steps).toHaveLength(1);
  });

  it('prefers function.yml when both function.yml and function.yaml exist', async () => {
    const projectRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'steps-functions-test-'));
    await makeCompositeFunctionAsync(
      projectRoot,
      'setup',
      ['name: FromYml', 'runs:', '  steps:', '    - run: echo yml'].join('\n')
    );
    await makeCompositeFunctionAsync(
      projectRoot,
      'setup',
      ['name: FromYaml', 'runs:', '  steps:', '    - run: echo yaml'].join('\n'),
      { fileName: 'function.yaml' }
    );

    const config = await loadLocalFunctionConfigAsync(projectRoot, './.eas/functions/setup');

    expect(config.name).toBe('FromYml');
  });

  it('throws a clear error when no function file exists at the referenced path', async () => {
    const projectRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'steps-functions-test-'));

    await expect(
      loadLocalFunctionConfigAsync(projectRoot, './.eas/functions/missing')
    ).rejects.toThrow(
      /Local composite function "\.\/\.eas\/functions\/missing" was referenced by a step but no such composite function exists/
    );
  });

  it('throws a parse error with a cause for invalid YAML syntax', async () => {
    const projectRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'steps-functions-test-'));
    await makeCompositeFunctionAsync(projectRoot, 'broken', 'runs: [unclosed');

    const error: Error = await loadLocalFunctionConfigAsync(
      projectRoot,
      './.eas/functions/broken'
    ).then(
      () => {
        throw new Error('expected loadLocalFunctionConfigAsync to throw');
      },
      err => err
    );

    expect(error.message).toMatch(
      /Failed to parse local composite function "\.\/\.eas\/functions\/broken" YAML at /
    );
    expect(error.cause).toBeInstanceOf(Error);
  });

  it('throws a validation error for a config that fails schema validation', async () => {
    const projectRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'steps-functions-test-'));
    await makeCompositeFunctionAsync(
      projectRoot,
      'broken',
      ['name: Broken', 'runs:', '  steps: []'].join('\n')
    );

    await expect(
      loadLocalFunctionConfigAsync(projectRoot, './.eas/functions/broken')
    ).rejects.toThrow(
      /Invalid composite function "\.\/\.eas\/functions\/broken": .*must declare at least one step under "runs\.steps"/s
    );
  });

  it('throws a read error with a cause for a non-ENOENT filesystem error', async () => {
    const projectRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'steps-functions-test-'));
    // A directory named function.yml makes readFile fail with EISDIR instead of ENOENT.
    await fs.mkdir(path.join(projectRoot, '.eas', 'functions', 'setup', 'function.yml'), {
      recursive: true,
    });

    const error: Error = await loadLocalFunctionConfigAsync(
      projectRoot,
      './.eas/functions/setup'
    ).then(
      () => {
        throw new Error('expected loadLocalFunctionConfigAsync to throw');
      },
      err => err
    );

    expect(error.message).toMatch(
      /Failed to read local composite function "\.\/\.eas\/functions\/setup" from /
    );
    expect((error.cause as NodeJS.ErrnoException).code).toBe('EISDIR');
  });

  it('resolves the referenced path relative to the project root, including paths above it', async () => {
    const repositoryRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'steps-functions-monorepo-'));
    const projectRoot = path.join(repositoryRoot, 'apps', 'mobile');
    await makeCompositeFunctionAsync(
      projectRoot,
      'setup',
      ['name: UnderProjectRoot', 'runs:', '  steps:', '    - run: echo setup'].join('\n')
    );
    const sharedFunctionDir = path.join(repositoryRoot, 'shared', 'functions', 'deploy');
    await fs.mkdir(sharedFunctionDir, { recursive: true });
    await fs.writeFile(
      path.join(sharedFunctionDir, 'function.yml'),
      ['name: AboveProjectRoot', 'runs:', '  steps:', '    - run: echo deploy'].join('\n'),
      'utf-8'
    );

    const underRoot = await loadLocalFunctionConfigAsync(projectRoot, './.eas/functions/setup');
    const aboveRoot = await loadLocalFunctionConfigAsync(
      projectRoot,
      '../../shared/functions/deploy'
    );

    expect(underRoot.name).toBe('UnderProjectRoot');
    expect(aboveRoot.name).toBe('AboveProjectRoot');
  });

  it('logs a debug message with the loaded file path', async () => {
    const projectRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'steps-functions-test-'));
    await makeCompositeFunctionAsync(
      projectRoot,
      'setup',
      ['runs:', '  steps:', '    - run: echo setup'].join('\n')
    );
    const logger = { debug: jest.fn() };

    await loadLocalFunctionConfigAsync(projectRoot, './.eas/functions/setup', { logger });

    expect(logger.debug).toHaveBeenCalledWith(
      `Loaded local composite function "./.eas/functions/setup" from ${path.join(
        '.eas',
        'functions',
        'setup',
        'function.yml'
      )}`
    );
  });
});

describe(createLocalFunctionLoader, () => {
  it('loads function.yml from disk for a normalized path', async () => {
    const projectRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'steps-functions-loader-'));
    await makeCompositeFunctionAsync(
      projectRoot,
      'setup',
      ['name: Setup', 'runs:', '  steps:', '    - run: echo setup'].join('\n')
    );

    const loader = createLocalFunctionLoader(projectRoot);
    const config = await loader('./.eas/functions/setup');

    expect(config.name).toBe('Setup');
    expect(config.runs.steps).toHaveLength(1);
  });

  it('rejects for a path with no composite function on disk', async () => {
    const projectRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'steps-functions-loader-'));

    const loader = createLocalFunctionLoader(projectRoot);

    await expect(loader('./.eas/functions/missing')).rejects.toThrow(
      /no such composite function exists/
    );
  });
});

describe(buildLocalFunctionCatalogAsync, () => {
  it('builds a catalog keyed by normalized ref, loading transitively nested functions from disk', async () => {
    const projectRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'steps-functions-catalog-'));
    await makeCompositeFunctionAsync(
      projectRoot,
      'outer',
      ['runs:', '  steps:', '    - uses: ./.eas/functions/inner'].join('\n')
    );
    await makeCompositeFunctionAsync(
      projectRoot,
      'inner',
      ['runs:', '  steps:', '    - run: echo inner'].join('\n')
    );

    const catalog = await buildLocalFunctionCatalogAsync(projectRoot, {
      rootSteps: [{ uses: './.eas/functions/outer/', id: 'outer' }],
    });

    expect(Object.keys(catalog).sort()).toEqual([
      './.eas/functions/inner',
      './.eas/functions/outer',
    ]);
  });

  it('loads a composite function referenced by an arbitrary path outside .eas/functions', async () => {
    const projectRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'steps-functions-catalog-'));
    const functionDir = path.join(projectRoot, 'internal-functions', 'deploy');
    await fs.mkdir(functionDir, { recursive: true });
    await fs.writeFile(
      path.join(functionDir, 'function.yml'),
      ['runs:', '  steps:', '    - run: echo deploy'].join('\n'),
      'utf-8'
    );

    const catalog = await buildLocalFunctionCatalogAsync(projectRoot, {
      rootSteps: [{ uses: './internal-functions/deploy' }],
    });

    expect(Object.keys(catalog)).toEqual(['./internal-functions/deploy']);
  });

  it('builds a catalog for a self-referencing function (cycles are reported at expansion time)', async () => {
    const projectRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'steps-functions-catalog-'));
    await makeCompositeFunctionAsync(
      projectRoot,
      'loop',
      ['runs:', '  steps:', '    - uses: ./.eas/functions/loop'].join('\n')
    );

    const catalog = await buildLocalFunctionCatalogAsync(projectRoot, {
      rootSteps: [{ uses: './.eas/functions/loop' }],
    });

    expect(Object.keys(catalog)).toEqual(['./.eas/functions/loop']);
  });

  it('builds a catalog for a function shared along multiple reference paths', async () => {
    const projectRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'steps-functions-catalog-'));
    await makeCompositeFunctionAsync(
      projectRoot,
      'shared',
      ['runs:', '  steps:', '    - run: echo shared'].join('\n')
    );
    await makeCompositeFunctionAsync(
      projectRoot,
      'left',
      ['runs:', '  steps:', '    - uses: ./.eas/functions/shared'].join('\n')
    );
    await makeCompositeFunctionAsync(
      projectRoot,
      'right',
      ['runs:', '  steps:', '    - uses: ./.eas/functions/shared'].join('\n')
    );

    const catalog = await buildLocalFunctionCatalogAsync(projectRoot, {
      rootSteps: [{ uses: './.eas/functions/left' }, { uses: './.eas/functions/right' }],
    });

    expect(Object.keys(catalog).sort()).toEqual([
      './.eas/functions/left',
      './.eas/functions/right',
      './.eas/functions/shared',
    ]);
  });

  it('ignores unreferenced malformed function files on disk', async () => {
    const projectRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'steps-functions-catalog-'));
    await makeCompositeFunctionAsync(
      projectRoot,
      'broken',
      ['name: Broken', 'runs:', '  steps: []'].join('\n')
    );

    const catalog = await buildLocalFunctionCatalogAsync(projectRoot, {
      rootSteps: [{ run: 'echo hi' }],
    });

    expect(catalog).toEqual({});
  });
});
