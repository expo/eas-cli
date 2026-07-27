import { promises as fs } from 'fs';
import os from 'os';
import path from 'path';

import { validateWorkflowLocalFunctionsAsync } from '../localFunctions';

async function makeProjectWithCompositeFunctionAsync(
  projectRoot: string,
  functionName: string,
  contents: string
): Promise<void> {
  const functionDir = path.join(projectRoot, '.eas', 'functions', functionName);
  await fs.mkdir(functionDir, { recursive: true });
  await fs.writeFile(path.join(functionDir, 'function.yml'), contents, 'utf-8');
}

describe(validateWorkflowLocalFunctionsAsync, () => {
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
      validateWorkflowLocalFunctionsAsync(workflow, projectRoot)
    ).resolves.toBeUndefined();
  });

  it('throws when a local composite function referenced from job steps does not exist', async () => {
    const projectRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'eas-workflow-functions-missing-'));
    const workflow = {
      jobs: {
        job: {
          steps: [{ uses: './.eas/functions/setup' }],
        },
      },
    };

    await expect(validateWorkflowLocalFunctionsAsync(workflow, projectRoot)).rejects.toThrow(
      /Local function "\.\/\.eas\/functions\/setup" was referenced by a step but no such local function exists/
    );
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

    await expect(validateWorkflowLocalFunctionsAsync(workflow, projectRoot)).rejects.toThrow(
      /must not contain interpolation/
    );
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
      validateWorkflowLocalFunctionsAsync(workflow, projectRoot)
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

    await expect(validateWorkflowLocalFunctionsAsync(workflow, projectRoot)).rejects.toThrow(
      /Local function "\.\/\.eas\/functions\/setup" was referenced by a step but no such local function exists/
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
      validateWorkflowLocalFunctionsAsync(workflow, projectRoot)
    ).resolves.toBeUndefined();
  });

  it('validates local composite functions referenced from defaults.hooks', async () => {
    const projectRoot = await fs.mkdtemp(
      path.join(os.tmpdir(), 'eas-workflow-functions-default-hooks-')
    );
    await makeProjectWithCompositeFunctionAsync(
      projectRoot,
      'setup',
      ['runs:', '  steps:', '    - run: echo setup'].join('\n')
    );
    const workflow = {
      defaults: {
        hooks: {
          before_install_node_modules: [{ uses: './.eas/functions/setup' }],
        },
      },
      jobs: {
        job: {
          steps: [{ run: 'echo hi' }],
        },
      },
    };

    await expect(
      validateWorkflowLocalFunctionsAsync(workflow, projectRoot)
    ).resolves.toBeUndefined();
  });

  it('throws when a composite function referenced from defaults.hooks does not exist', async () => {
    const projectRoot = await fs.mkdtemp(
      path.join(os.tmpdir(), 'eas-workflow-functions-default-hooks-missing-')
    );
    const workflow = {
      defaults: {
        hooks: {
          before_install_node_modules: [{ uses: './.eas/functions/setup' }],
        },
      },
      jobs: {
        job: {
          steps: [{ run: 'echo hi' }],
        },
      },
    };

    await expect(validateWorkflowLocalFunctionsAsync(workflow, projectRoot)).rejects.toThrow(
      /Local function "\.\/\.eas\/functions\/setup" was referenced by a step but no such local function exists/
    );
  });

  it('ignores non-object defaults and non-object defaults.hooks', async () => {
    const projectRoot = await fs.mkdtemp(
      path.join(os.tmpdir(), 'eas-workflow-functions-default-hooks-garbage-')
    );
    const jobs = {
      job: {
        steps: [{ run: 'echo hi' }],
      },
    };

    await expect(
      validateWorkflowLocalFunctionsAsync({ defaults: 'garbage', jobs }, projectRoot)
    ).resolves.toBeUndefined();
    await expect(
      validateWorkflowLocalFunctionsAsync({ defaults: { hooks: 'garbage' }, jobs }, projectRoot)
    ).resolves.toBeUndefined();
  });

  it('resolves "./" paths against the project directory, not the repository root', async () => {
    const repoRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'eas-workflow-functions-monorepo-'));
    const projectDir = path.join(repoRoot, 'apps', 'mobile');
    await makeProjectWithCompositeFunctionAsync(
      repoRoot,
      'notify',
      ['runs:', '  steps:', '    - run: echo repo root'].join('\n')
    );
    await makeProjectWithCompositeFunctionAsync(
      projectDir,
      'notify',
      ['runs:', '  steps:', '    - run: echo app'].join('\n')
    );
    const workflow = {
      jobs: {
        job: {
          steps: [{ uses: './.eas/functions/notify' }],
        },
      },
    };

    await expect(
      validateWorkflowLocalFunctionsAsync(workflow, projectDir)
    ).resolves.toBeUndefined();
  });

  it('does not fall back to the repository root when the function is missing under the project directory', async () => {
    const repoRoot = await fs.mkdtemp(
      path.join(os.tmpdir(), 'eas-workflow-functions-monorepo-no-fallback-')
    );
    const projectDir = path.join(repoRoot, 'apps', 'mobile');
    await fs.mkdir(projectDir, { recursive: true });
    await makeProjectWithCompositeFunctionAsync(
      repoRoot,
      'notify',
      ['runs:', '  steps:', '    - run: echo repo root'].join('\n')
    );
    const workflow = {
      jobs: {
        job: {
          steps: [{ uses: './.eas/functions/notify' }],
        },
      },
    };

    await expect(validateWorkflowLocalFunctionsAsync(workflow, projectDir)).rejects.toThrow(
      /Local function "\.\/\.eas\/functions\/notify" was referenced by a step but no such local function exists/
    );
  });

  it('validates functions referenced with an explicit path above the project directory', async () => {
    const repoRoot = await fs.mkdtemp(
      path.join(os.tmpdir(), 'eas-workflow-functions-monorepo-upward-')
    );
    const projectDir = path.join(repoRoot, 'apps', 'mobile');
    await fs.mkdir(projectDir, { recursive: true });
    await makeProjectWithCompositeFunctionAsync(
      repoRoot,
      'notify',
      ['runs:', '  steps:', '    - run: echo repo root'].join('\n')
    );
    const workflow = {
      jobs: {
        job: {
          steps: [{ uses: '../../.eas/functions/notify' }],
        },
      },
    };

    await expect(
      validateWorkflowLocalFunctionsAsync(workflow, projectDir)
    ).resolves.toBeUndefined();
  });

  it('validates a referenced single-step command function', async () => {
    const projectRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'eas-workflow-functions-command-'));
    await makeProjectWithCompositeFunctionAsync(
      projectRoot,
      'say-hi',
      ['inputs:', '  - name', 'command: echo "Hi, ${ inputs.name }!"'].join('\n')
    );
    const workflow = {
      jobs: {
        job: {
          steps: [{ uses: './.eas/functions/say-hi', with: { name: 'World' } }],
        },
      },
    };

    await expect(
      validateWorkflowLocalFunctionsAsync(workflow, projectRoot)
    ).resolves.toBeUndefined();
  });
});
