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
  fetchTemplatePackumentAsync,
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

  describe('fetchTemplatePackumentAsync', () => {
    it('should fetch the packument from the npm registry', async () => {
      const packument = { 'dist-tags': { latest: '57.0.19' } };
      jest.mocked(fetch).mockResolvedValueOnce({ json: async () => packument } as any);

      expect(await fetchTemplatePackumentAsync()).toEqual(packument);
      expect(fetch).toHaveBeenCalledWith(
        'https://registry.npmjs.org/expo-template-default',
        expect.objectContaining({
          headers: { accept: 'application/vnd.npm.install-v1+json' },
        })
      );
    });
  });

  describe('downloadTemplateAsync', () => {
    const template = {
      npmTag: 'sdk-56',
      version: '56.0.34',
      tarballUrl: 'https://registry.npmjs.org/expo-template-default/-/56.0.34.tgz',
    };

    it('should download and extract the template', async () => {
      const targetProjectDir = '/test/target-project';
      const tarballBody = 'tarball-stream';

      jest.mocked(fs.pathExists).mockResolvedValueOnce(false as never);
      jest.mocked(fetch).mockResolvedValueOnce({ body: tarballBody } as any);
      jest.mocked(glob).mockResolvedValueOnce(['gitignore', '_vscode'] as any);

      const result = await downloadTemplateAsync(targetProjectDir, template);

      expect(fetch).toHaveBeenCalledWith(
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

    it('should throw when the target directory exists and is not empty', async () => {
      jest.mocked(fs.pathExists).mockResolvedValueOnce(true as never);
      jest.mocked(fs.readdir).mockResolvedValueOnce(['existing-file'] as never);

      await expect(downloadTemplateAsync('/test/target-project', template)).rejects.toThrow(
        'already exists and is not empty'
      );
    });

    it('should not remove a pre-existing directory on failure', async () => {
      jest.mocked(fs.pathExists).mockResolvedValueOnce(true as never);
      jest.mocked(fs.readdir).mockResolvedValueOnce(['existing-file'] as never);

      await expect(downloadTemplateAsync('/test/target-project', template)).rejects.toThrow();
      expect(fs.remove).not.toHaveBeenCalled();
    });

    it('should clean up a partially extracted directory on failure', async () => {
      jest.mocked(fs.pathExists).mockResolvedValueOnce(false as never);
      jest.mocked(fetch).mockRejectedValueOnce(new Error('network error'));

      await expect(downloadTemplateAsync('/test/target-project', template)).rejects.toThrow(
        'network error'
      );
      expect(fs.remove).toHaveBeenCalledWith('/test/target-project');
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
