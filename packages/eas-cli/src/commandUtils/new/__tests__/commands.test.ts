import glob from 'fast-glob';
import fs from 'fs-extra';
import { pipeline } from 'stream/promises';
import { extract } from 'tar';

import fetch from '../../../fetch';
import { installDependenciesAsync } from '../../../onboarding/installDependencies';
import { runCommandAsync } from '../../../onboarding/runCommand';
import { expoCommandAsync } from '../../../utils/expoCli';
import {
  downloadTemplateAsync,
  initializeGitRepositoryAsync,
  installProjectDependenciesAsync,
} from '../commands';

jest.mock('../../../utils/expoCli');
jest.mock('../../../fetch');
jest.mock('../../../onboarding/runCommand');
jest.mock('../../../onboarding/installDependencies');
jest.mock('../../../ora');
jest.mock('fs-extra');
jest.mock('tar');
jest.mock('stream/promises');
jest.mock('fast-glob');

describe('commands', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('downloadTemplateAsync', () => {
    const packument = {
      'dist-tags': { latest: '57.0.19', 'sdk-56': '56.0.34' },
      versions: {
        '57.0.19': {
          dist: { tarball: 'https://registry.npmjs.org/expo-template-default/-/57.0.19.tgz' },
        },
        '56.0.34': {
          dist: { tarball: 'https://registry.npmjs.org/expo-template-default/-/56.0.34.tgz' },
        },
      },
    };

    it('should download and extract the template for the given npm tag', async () => {
      const targetProjectDir = '/test/target-project';
      const tarballBody = 'tarball-stream';

      jest
        .mocked(fetch)
        .mockResolvedValueOnce({ json: async () => packument } as any)
        .mockResolvedValueOnce({ body: tarballBody } as any);
      jest.mocked(glob).mockResolvedValueOnce(['gitignore', '_vscode'] as any);

      const result = await downloadTemplateAsync(targetProjectDir, 'sdk-56');

      expect(fetch).toHaveBeenNthCalledWith(
        1,
        'https://registry.npmjs.org/expo-template-default',
        expect.anything()
      );
      expect(fetch).toHaveBeenNthCalledWith(
        2,
        'https://registry.npmjs.org/expo-template-default/-/56.0.34.tgz'
      );
      expect(extract).toHaveBeenCalledWith({ cwd: targetProjectDir, strip: 1 });
      expect(pipeline).toHaveBeenCalledWith(tarballBody, extract({} as any));
      expect(fs.move).toHaveBeenCalledWith(
        '/test/target-project/gitignore',
        '/test/target-project/.gitignore',
        { overwrite: true }
      );
      expect(fs.move).toHaveBeenCalledWith(
        '/test/target-project/_vscode',
        '/test/target-project/.vscode',
        { overwrite: true }
      );
      expect(result).toBe(targetProjectDir);
    });

    it('should throw when the npm tag does not exist', async () => {
      jest.mocked(fetch).mockResolvedValueOnce({ json: async () => packument } as any);

      await expect(downloadTemplateAsync('/test/target-project', 'sdk-1')).rejects.toThrow(
        'Could not find version "sdk-1" of expo-template-default on npm.'
      );
    });
  });

  describe('installProjectDependenciesAsync', () => {
    it('should install the project dependencies', async () => {
      const projectDir = '/test/project-directory';

      jest.mocked(installDependenciesAsync).mockResolvedValue();
      jest.mocked(runCommandAsync).mockResolvedValue();

      await installProjectDependenciesAsync(projectDir, 'npm');

      expect(installDependenciesAsync).toHaveBeenCalledWith({
        outputLevel: 'none',
        projectDir,
        packageManager: 'npm',
      });

      expect(expoCommandAsync).toHaveBeenCalledWith(
        projectDir,
        ['install', 'expo-updates', '@expo/metro-runtime'],
        { silent: true }
      );
    });
  });

  describe('initializeGitRepositoryAsync', () => {
    it('should initialize git repository', async () => {
      const projectDir = '/test/project-dir';

      await initializeGitRepositoryAsync(projectDir);

      expect(runCommandAsync).toHaveBeenCalledWith({
        command: 'git',
        args: ['init'],
        cwd: projectDir,
        showOutput: false,
        showSpinner: false,
      });

      expect(runCommandAsync).toHaveBeenCalledWith({
        command: 'git',
        args: ['add', '.'],
        cwd: projectDir,
        showOutput: false,
        showSpinner: false,
      });

      expect(runCommandAsync).toHaveBeenCalledWith({
        command: 'git',
        args: ['commit', '-m', 'Initial commit'],
        cwd: projectDir,
        showOutput: false,
        showSpinner: false,
      });
    });
  });
});
