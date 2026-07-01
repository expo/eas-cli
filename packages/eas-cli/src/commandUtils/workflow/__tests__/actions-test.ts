import { promises as fs } from 'fs';
import os from 'os';
import path from 'path';

import { validateWorkflowLocalActionsAsync } from '../actions';

async function makeProjectWithActionAsync(
  projectRoot: string,
  actionName: string,
  contents: string
): Promise<void> {
  const actionDir = path.join(projectRoot, '.eas', 'actions', actionName);
  await fs.mkdir(actionDir, { recursive: true });
  await fs.writeFile(path.join(actionDir, 'action.yml'), contents, 'utf-8');
}

describe(validateWorkflowLocalActionsAsync, () => {
  it('validates referenced local actions', async () => {
    const projectRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'eas-workflow-actions-test-'));
    await makeProjectWithActionAsync(
      projectRoot,
      'setup',
      ['runs:', '  steps:', '    - run: echo setup'].join('\n')
    );
    const workflow = {
      jobs: {
        job: {
          steps: [{ uses: './.eas/actions/setup' }],
        },
      },
    };

    await expect(validateWorkflowLocalActionsAsync(workflow, projectRoot)).resolves.toBeUndefined();
  });

  it('resolves local actions from the EAS project directory in monorepos', async () => {
    const repositoryRoot = await fs.mkdtemp(
      path.join(os.tmpdir(), 'eas-workflow-actions-monorepo-')
    );
    const projectDir = path.join(repositoryRoot, 'apps', 'mobile');
    await fs.mkdir(projectDir, { recursive: true });
    await makeProjectWithActionAsync(
      projectDir,
      'setup',
      ['runs:', '  steps:', '    - run: echo setup'].join('\n')
    );

    const workflow = {
      jobs: {
        job: {
          steps: [{ uses: './.eas/actions/setup' }],
        },
      },
    };

    await expect(validateWorkflowLocalActionsAsync(workflow, projectDir)).resolves.toBeUndefined();
  });

  it('does not treat repository-root actions as valid when the EAS project is in a subdirectory', async () => {
    const repositoryRoot = await fs.mkdtemp(
      path.join(os.tmpdir(), 'eas-workflow-actions-monorepo-')
    );
    const projectDir = path.join(repositoryRoot, 'apps', 'mobile');
    await fs.mkdir(projectDir, { recursive: true });
    await makeProjectWithActionAsync(
      repositoryRoot,
      'setup',
      ['runs:', '  steps:', '    - run: echo setup'].join('\n')
    );

    const workflow = {
      jobs: {
        job: {
          steps: [{ uses: './.eas/actions/setup' }],
        },
      },
    };

    await expect(validateWorkflowLocalActionsAsync(workflow, projectDir)).rejects.toThrow(
      /do not exist: "\.\/\.eas\/actions\/setup"/
    );
  });

  it('ignores unreferenced malformed actions on disk', async () => {
    const projectRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'eas-workflow-actions-test-'));
    await makeProjectWithActionAsync(
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

    await expect(validateWorkflowLocalActionsAsync(workflow, projectRoot)).resolves.toBeUndefined();
  });

  it('throws when a referenced local action does not exist', async () => {
    const projectRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'eas-workflow-actions-missing-'));
    const workflow = {
      jobs: {
        job: {
          steps: [{ uses: './.eas/actions/setup' }],
        },
      },
    };

    await expect(validateWorkflowLocalActionsAsync(workflow, projectRoot)).rejects.toThrow(
      /do not exist: "\.\/\.eas\/actions\/setup"/
    );
  });

  it('throws when a local action references itself', async () => {
    const projectRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'eas-workflow-actions-cycle-'));
    await makeProjectWithActionAsync(
      projectRoot,
      'loop',
      ['runs:', '  steps:', '    - uses: ./.eas/actions/loop'].join('\n')
    );
    const workflow = {
      jobs: {
        job: {
          steps: [{ uses: './.eas/actions/loop' }],
        },
      },
    };

    await expect(validateWorkflowLocalActionsAsync(workflow, projectRoot)).rejects.toThrow(
      /form a cycle: \.\/\.eas\/actions\/loop -> \.\/\.eas\/actions\/loop/
    );
  });

  it('throws when local actions form an indirect cycle', async () => {
    const projectRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'eas-workflow-actions-cycle-'));
    await makeProjectWithActionAsync(
      projectRoot,
      'a',
      ['runs:', '  steps:', '    - uses: ./.eas/actions/b'].join('\n')
    );
    await makeProjectWithActionAsync(
      projectRoot,
      'b',
      ['runs:', '  steps:', '    - uses: ./.eas/actions/a'].join('\n')
    );
    const workflow = {
      jobs: {
        job: {
          steps: [{ uses: './.eas/actions/a' }],
        },
      },
    };

    await expect(validateWorkflowLocalActionsAsync(workflow, projectRoot)).rejects.toThrow(
      /form a cycle/
    );
  });

  it('validates a shared local action referenced along multiple paths', async () => {
    const projectRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'eas-workflow-actions-diamond-'));
    await makeProjectWithActionAsync(
      projectRoot,
      'shared',
      ['runs:', '  steps:', '    - run: echo shared'].join('\n')
    );
    await makeProjectWithActionAsync(
      projectRoot,
      'left',
      ['runs:', '  steps:', '    - uses: ./.eas/actions/shared'].join('\n')
    );
    await makeProjectWithActionAsync(
      projectRoot,
      'right',
      ['runs:', '  steps:', '    - uses: ./.eas/actions/shared'].join('\n')
    );
    const workflow = {
      jobs: {
        job: {
          steps: [{ uses: './.eas/actions/left' }, { uses: './.eas/actions/right' }],
        },
      },
    };

    await expect(validateWorkflowLocalActionsAsync(workflow, projectRoot)).resolves.toBeUndefined();
  });

  it('throws when a referenced local action is malformed', async () => {
    const projectRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'eas-workflow-actions-test-'));
    await makeProjectWithActionAsync(
      projectRoot,
      'broken',
      ['name: Broken', 'runs:', '  steps: []'].join('\n')
    );
    const workflow = {
      jobs: {
        job: {
          steps: [{ uses: './.eas/actions/broken' }],
        },
      },
    };

    await expect(validateWorkflowLocalActionsAsync(workflow, projectRoot)).rejects.toThrow(
      /must declare at least one step under "runs.steps"/
    );
  });
});
