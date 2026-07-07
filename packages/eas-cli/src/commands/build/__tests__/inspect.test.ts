import fs from 'fs-extra';
import path from 'path';

import { getMockOclifConfig } from '../../../__tests__/commands/utils';
import { runBuildAndSubmitAsync } from '../../../build/runBuildAndSubmit';
import BuildInspect from '../inspect';

jest.mock('fs-extra', () => ({
  pathExists: jest.fn(),
  remove: jest.fn(),
  mkdirp: jest.fn(),
  copy: jest.fn(),
}));
jest.mock('../../../build/runBuildAndSubmit', () => ({
  runBuildAndSubmitAsync: jest.fn(),
}));
jest.mock('../../../log');
jest.mock('../../../ora', () => ({
  ora: jest.fn(() => ({
    start: jest.fn(() => ({
      succeed: jest.fn(),
      fail: jest.fn(),
    })),
  })),
}));
jest.mock('../../../utils/paths', () => ({
  ...jest.requireActual('../../../utils/paths'),
  getTmpDirectory: jest.fn(() => '/tmp/eas-cli'),
}));
jest.mock('uuid', () => ({
  v4: jest.fn(() => 'tmp-id'),
}));

describe(BuildInspect, () => {
  const mockConfig = getMockOclifConfig();
  const tmpWorkingdir = '/tmp/eas-cli/tmp-id';
  const tmpBuildDir = path.join(tmpWorkingdir, 'build');
  const outputDirectory = path.join(process.cwd(), 'inspect-output');
  const mockPathExists = fs.pathExists as jest.Mock;
  const mockMkdirp = fs.mkdirp as jest.Mock;
  const mockCopy = fs.copy as jest.Mock;
  const mockRemove = fs.remove as jest.Mock;

  beforeEach(() => {
    jest.clearAllMocks();
    mockPathExists.mockResolvedValue(false);
    mockMkdirp.mockResolvedValue(undefined);
    mockCopy.mockResolvedValue(undefined);
    mockRemove.mockResolvedValue(undefined);
    jest.mocked(runBuildAndSubmitAsync).mockResolvedValue({ buildIds: [] });
  });

  function createCommand(): BuildInspect {
    const command = new BuildInspect(
      ['--platform', 'ios', '--stage', 'pre-build', '--output', 'inspect-output'],
      mockConfig
    );
    jest.spyOn(command as any, 'getContextAsync').mockResolvedValue({
      loggedIn: {
        actor: {},
        graphqlClient: {},
      },
      getDynamicPrivateProjectConfigAsync: jest.fn(),
      projectDir: '/project',
      analytics: {},
      vcsClient: {},
    } as any);
    return command;
  }

  it('removes the temporary working directory after copying output when the build fails', async () => {
    jest.mocked(runBuildAndSubmitAsync).mockRejectedValue(new Error('build failed'));
    mockPathExists.mockResolvedValueOnce(false).mockResolvedValueOnce(true);

    await createCommand().runAsync();

    expect(fs.copy).toHaveBeenCalledWith(tmpBuildDir, outputDirectory);
    expect(fs.remove).toHaveBeenCalledWith(tmpBuildDir);
    expect(fs.remove).toHaveBeenCalledWith(tmpWorkingdir);
  });

  it('keeps the temporary working directory when copying output fails', async () => {
    jest.mocked(runBuildAndSubmitAsync).mockRejectedValue(new Error('build failed'));
    mockPathExists.mockResolvedValueOnce(false).mockResolvedValueOnce(true);
    mockCopy.mockRejectedValue(new Error('copy failed'));

    await expect(createCommand().runAsync()).rejects.toThrow('copy failed');

    expect(fs.remove).not.toHaveBeenCalledWith(tmpBuildDir);
    expect(fs.remove).not.toHaveBeenCalledWith(tmpWorkingdir);
  });
});
