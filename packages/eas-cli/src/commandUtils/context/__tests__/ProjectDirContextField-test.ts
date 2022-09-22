import { vol } from 'memfs';

import ProjectDirContextField from '../ProjectDirContextField';

jest.mock('@expo/config');
jest.mock('fs');

jest.mock('../../../prompts');

beforeEach(() => {
  jest.resetAllMocks();
});

describe(ProjectDirContextField['findProjectRootAsync'], () => {
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
    await expect(ProjectDirContextField['findProjectRootAsync']({ cwd: '/app' })).rejects.toThrow(
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
      const projectDir = await ProjectDirContextField['findProjectRootAsync']({
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
    const projectRoot = await ProjectDirContextField['findProjectRootAsync']({ cwd: '/app/src' });
    expect(projectRoot).toBe('/app');
  });
});
