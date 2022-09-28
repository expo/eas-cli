import { vol } from 'memfs';

import { findProjectRootAsync } from '../findProjectDirAndVerifyProjectSetupAsync';

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
