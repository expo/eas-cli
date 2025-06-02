import { vol } from 'memfs';

import { easCliVersion } from '../../../../utils/easCli';
import {
  findProjectDirAndVerifyProjectSetupAsync,
  findProjectRootAsync,
} from '../findProjectDirAndVerifyProjectSetupAsync';

jest.mock('@expo/config');
jest.mock('fs');

jest.mock('../../../../prompts');

beforeEach(() => {
  jest.resetAllMocks();
});

describe(findProjectRootAsync, () => {
  beforeEach(() => {
    vol.reset();
  });

  it('throws if not inside the project directory', async () => {
    vol.fromJSON(
      {
        './README.md': '1',
      },
      '/app'
    );
    await expect(findProjectRootAsync({ cwd: '/app' })).rejects.toThrow(
      'Run this command inside a project directory.'
    );
  });

  it('defaults to process.cwd() if defaultToProcessCwd = true', async () => {
    const spy = jest.spyOn(process, 'cwd').mockReturnValue('/this/is/fake/process/cwd');
    try {
      vol.fromJSON(
        {
          './README.md': '1',
        },
        '/app'
      );
      const projectDir = await findProjectRootAsync({
        cwd: '/app',
        defaultToProcessCwd: true,
      });
      expect(projectDir).toBe('/this/is/fake/process/cwd');
    } finally {
      spy.mockRestore();
    }
  });

  it('returns the root directory of the project', async () => {
    vol.fromJSON(
      {
        './README.md': '1',
        './package.json': '2',
        './src/index.ts': '3',
      },
      '/app'
    );
    const projectRoot = await findProjectRootAsync({ cwd: '/app/src' });
    expect(projectRoot).toBe('/app');
  });
});

describe(findProjectDirAndVerifyProjectSetupAsync, () => {
  it('throws if the CLI version is not satisfied', async () => {
    vol.fromJSON(
      {
        './eas.json': JSON.stringify({ cli: { version: '1.0.0' } }),
        './package.json': JSON.stringify({}),
      },
      '/app'
    );
    await expect(findProjectDirAndVerifyProjectSetupAsync({ cwd: '/app' })).rejects.toThrow(
      new RegExp(
        `^You are on eas-cli@${easCliVersion} which does not satisfy the CLI version constraint defined in eas.json \\(1.0.0\\)`,
        's'
      )
    );

    process.env.EAS_SKIP_CLI_VERSION_CHECK = 'true';
    await expect(findProjectDirAndVerifyProjectSetupAsync({ cwd: '/app' })).resolves.not.toThrow();
    delete process.env.EAS_SKIP_CLI_VERSION_CHECK;

    await expect(findProjectDirAndVerifyProjectSetupAsync({ cwd: '/app' })).rejects.toThrow(
      new RegExp(
        `^You are on eas-cli@${easCliVersion} which does not satisfy the CLI version constraint defined in eas.json \\(1.0.0\\)`,
        's'
      )
    );
  });

  it('does not throw if the CLI version is satisfied', async () => {
    vol.fromJSON(
      {
        './eas.json': JSON.stringify({ cli: { version: '>= 1.0.0' } }),
        './package.json': JSON.stringify({}),
      },
      '/app'
    );
    await expect(findProjectDirAndVerifyProjectSetupAsync({ cwd: '/app' })).resolves.not.toThrow();
  });

  it('does not throw if there is no version', async () => {
    vol.fromJSON(
      {
        './eas.json': JSON.stringify({}),
        './package.json': JSON.stringify({}),
      },
      '/app'
    );
    await expect(findProjectDirAndVerifyProjectSetupAsync({ cwd: '/app' })).resolves.not.toThrow();
  });
});
