import { vol } from 'memfs';
import pkgDir from 'pkg-dir';

import ProjectDirContextField from '../ProjectDirContextField';

jest.mock('@expo/config');
jest.mock('fs');
jest.mock('pkg-dir');

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
    await expect(ProjectDirContextField['findProjectRootAsync']()).rejects.toThrow(
      'Run this command inside a project directory.'
    );
  });

  it('returns the root directory of the project', async () => {
    jest.mocked(pkgDir).mockResolvedValue('/app');
    vol.fromJSON(
      {
        './README.md': '1',
        './package.json': '2',
        './src/index.ts': '3',
      },
      '/app'
    );
    const projectRoot = await ProjectDirContextField['findProjectRootAsync']();
    expect(projectRoot).toBe('/app');
  });
});
