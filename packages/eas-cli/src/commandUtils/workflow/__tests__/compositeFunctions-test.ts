import { promises as fs } from 'fs';
import os from 'os';
import path from 'path';

import { validateWorkflowLocalCompositeFunctionsAsync } from '../compositeFunctions';

async function makeProjectWithCompositeFunctionAsync(
  projectRoot: string,
  functionName: string,
  contents: string
): Promise<void> {
  const functionDir = path.join(projectRoot, '.eas', 'functions', functionName);
  await fs.mkdir(functionDir, { recursive: true });
  await fs.writeFile(path.join(functionDir, 'function.yml'), contents, 'utf-8');
}

describe(validateWorkflowLocalCompositeFunctionsAsync, () => {
  it('validates referenced local composite functions', async () => {
    const projectRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'eas-workflow-functions-test-'));
    await makeProjectWithCompositeFunctionAsync(
      projectRoot,
      'setup',
      ['runs:', '  steps:', '    - run: echo setup'].join('\n')
    );
    const workflow = {
      jobs: {
        job: {
          steps: [{ uses: './.eas/functions/setup' }],
        },
      },
    };

    await expect(
      validateWorkflowLocalCompositeFunctionsAsync(workflow, projectRoot)
    ).resolves.toBeUndefined();
  });

  it('resolves local composite functions from the EAS project directory in monorepos', async () => {
    const repositoryRoot = await fs.mkdtemp(
      path.join(os.tmpdir(), 'eas-workflow-functions-monorepo-')
    );
    const projectDir = path.join(repositoryRoot, 'apps', 'mobile');
    await fs.mkdir(projectDir, { recursive: true });
    await makeProjectWithCompositeFunctionAsync(
      projectDir,
      'setup',
      ['runs:', '  steps:', '    - run: echo setup'].join('\n')
    );

    const workflow = {
      jobs: {
        job: {
          steps: [{ uses: './.eas/functions/setup' }],
        },
      },
    };

    await expect(
      validateWorkflowLocalCompositeFunctionsAsync(workflow, projectDir)
    ).resolves.toBeUndefined();
  });

  it('does not treat repository-root composite functions as valid when the EAS project is in a subdirectory', async () => {
    const repositoryRoot = await fs.mkdtemp(
      path.join(os.tmpdir(), 'eas-workflow-functions-monorepo-')
    );
    const projectDir = path.join(repositoryRoot, 'apps', 'mobile');
    await fs.mkdir(projectDir, { recursive: true });
    await makeProjectWithCompositeFunctionAsync(
      repositoryRoot,
      'setup',
      ['runs:', '  steps:', '    - run: echo setup'].join('\n')
    );

    const workflow = {
      jobs: {
        job: {
          steps: [{ uses: './.eas/functions/setup' }],
        },
      },
    };

    await expect(
      validateWorkflowLocalCompositeFunctionsAsync(workflow, projectDir)
    ).rejects.toThrow(
      /Local composite function "\.\/\.eas\/functions\/setup" was referenced by a step but no such composite function exists/
    );
  });

  it('ignores unreferenced malformed composite functions on disk', async () => {
    const projectRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'eas-workflow-functions-test-'));
    await makeProjectWithCompositeFunctionAsync(
      projectRoot,
      'broken',
      ['name: Broken', 'runs:', '  steps: []'].join('\n')
    );
    const workflow = {
      jobs: {
        job: {
          steps: [{ run: 'echo hi' }],
        },
      },
    };

    await expect(
      validateWorkflowLocalCompositeFunctionsAsync(workflow, projectRoot)
    ).resolves.toBeUndefined();
  });

  it('validates composite functions referenced by an arbitrary path (arbitrary path style)', async () => {
    const projectRoot = await fs.mkdtemp(
      path.join(os.tmpdir(), 'eas-workflow-functions-arbitrary-')
    );
    const functionDir = path.join(projectRoot, 'internal-functions', 'deploy');
    await fs.mkdir(functionDir, { recursive: true });
    await fs.writeFile(
      path.join(functionDir, 'function.yml'),
      ['runs:', '  steps:', '    - run: echo deploy'].join('\n'),
      'utf-8'
    );
    const workflow = {
      jobs: {
        job: {
          steps: [{ uses: './internal-functions/deploy' }],
        },
      },
    };

    await expect(
      validateWorkflowLocalCompositeFunctionsAsync(workflow, projectRoot)
    ).resolves.toBeUndefined();
  });

  it('rejects interpolated local composite function references', async () => {
    const projectRoot = await fs.mkdtemp(
      path.join(os.tmpdir(), 'eas-workflow-functions-interpolated-')
    );
    const workflow = {
      jobs: {
        job: {
          steps: [{ uses: './.eas/functions/${{ inputs.name }}' }],
        },
      },
    };

    await expect(
      validateWorkflowLocalCompositeFunctionsAsync(workflow, projectRoot)
    ).rejects.toThrow(/must not contain interpolation/);
  });

  it('throws when a referenced local composite function does not exist', async () => {
    const projectRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'eas-workflow-functions-missing-'));
    const workflow = {
      jobs: {
        job: {
          steps: [{ uses: './.eas/functions/setup' }],
        },
      },
    };

    await expect(
      validateWorkflowLocalCompositeFunctionsAsync(workflow, projectRoot)
    ).rejects.toThrow(
      /Local composite function "\.\/\.eas\/functions\/setup" was referenced by a step but no such composite function exists/
    );
  });

  it('validates cyclic local composite functions (cycles are reported at expansion time)', async () => {
    const projectRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'eas-workflow-functions-cycle-'));
    await makeProjectWithCompositeFunctionAsync(
      projectRoot,
      'loop',
      ['runs:', '  steps:', '    - uses: ./.eas/functions/loop'].join('\n')
    );
    const workflow = {
      jobs: {
        job: {
          steps: [{ uses: './.eas/functions/loop' }],
        },
      },
    };

    await expect(
      validateWorkflowLocalCompositeFunctionsAsync(workflow, projectRoot)
    ).resolves.toBeUndefined();
  });

  it('validates indirectly cyclic local composite functions (cycles are reported at expansion time)', async () => {
    const projectRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'eas-workflow-functions-cycle-'));
    await makeProjectWithCompositeFunctionAsync(
      projectRoot,
      'a',
      ['runs:', '  steps:', '    - uses: ./.eas/functions/b'].join('\n')
    );
    await makeProjectWithCompositeFunctionAsync(
      projectRoot,
      'b',
      ['runs:', '  steps:', '    - uses: ./.eas/functions/a'].join('\n')
    );
    const workflow = {
      jobs: {
        job: {
          steps: [{ uses: './.eas/functions/a' }],
        },
      },
    };

    await expect(
      validateWorkflowLocalCompositeFunctionsAsync(workflow, projectRoot)
    ).resolves.toBeUndefined();
  });

  it('validates a shared local composite function referenced along multiple paths', async () => {
    const projectRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'eas-workflow-functions-diamond-'));
    await makeProjectWithCompositeFunctionAsync(
      projectRoot,
      'shared',
      ['runs:', '  steps:', '    - run: echo shared'].join('\n')
    );
    await makeProjectWithCompositeFunctionAsync(
      projectRoot,
      'left',
      ['runs:', '  steps:', '    - uses: ./.eas/functions/shared'].join('\n')
    );
    await makeProjectWithCompositeFunctionAsync(
      projectRoot,
      'right',
      ['runs:', '  steps:', '    - uses: ./.eas/functions/shared'].join('\n')
    );
    const workflow = {
      jobs: {
        job: {
          steps: [{ uses: './.eas/functions/left' }, { uses: './.eas/functions/right' }],
        },
      },
    };

    await expect(
      validateWorkflowLocalCompositeFunctionsAsync(workflow, projectRoot)
    ).resolves.toBeUndefined();
  });

  it('validates local composite functions referenced from job hooks', async () => {
    const projectRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'eas-workflow-functions-hooks-'));
    await makeProjectWithCompositeFunctionAsync(
      projectRoot,
      'setup',
      ['runs:', '  steps:', '    - run: echo setup'].join('\n')
    );
    const workflow = {
      jobs: {
        job: {
          steps: [{ run: 'echo hi' }],
          hooks: {
            before_install_node_modules: [{ uses: './.eas/functions/setup' }],
          },
        },
      },
    };

    await expect(
      validateWorkflowLocalCompositeFunctionsAsync(workflow, projectRoot)
    ).resolves.toBeUndefined();
  });

  it('throws when a composite function referenced from a job hook does not exist', async () => {
    const projectRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'eas-workflow-functions-hooks-'));
    const workflow = {
      jobs: {
        job: {
          steps: [{ run: 'echo hi' }],
          hooks: {
            before_install_node_modules: [{ uses: './.eas/functions/setup' }],
          },
        },
      },
    };

    await expect(
      validateWorkflowLocalCompositeFunctionsAsync(workflow, projectRoot)
    ).rejects.toThrow(
      /Local composite function "\.\/\.eas\/functions\/setup" was referenced by a step but no such composite function exists/
    );
  });

  it('ignores non-object hooks and non-array hook values', async () => {
    const projectRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'eas-workflow-functions-hooks-'));
    const workflow = {
      jobs: {
        garbageHooks: {
          steps: [{ run: 'echo hi' }],
          hooks: 'not an object',
        },
        garbageHookValue: {
          steps: [{ run: 'echo hi' }],
          hooks: {
            before_install_node_modules: 'not an array',
            after_install_node_modules: { uses: './.eas/functions/missing' },
          },
        },
      },
    };

    await expect(
      validateWorkflowLocalCompositeFunctionsAsync(workflow, projectRoot)
    ).resolves.toBeUndefined();
  });

  it('throws when a referenced local composite function is malformed', async () => {
    const projectRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'eas-workflow-functions-test-'));
    await makeProjectWithCompositeFunctionAsync(
      projectRoot,
      'broken',
      ['name: Broken', 'runs:', '  steps: []'].join('\n')
    );
    const workflow = {
      jobs: {
        job: {
          steps: [{ uses: './.eas/functions/broken' }],
        },
      },
    };

    await expect(
      validateWorkflowLocalCompositeFunctionsAsync(workflow, projectRoot)
    ).rejects.toThrow(/must declare at least one step under "runs.steps"/);
  });
});
