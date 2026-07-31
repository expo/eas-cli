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

  it('throws when a local composite function referenced from job steps does not exist', async () => {
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
});
