import { canAccessRepositoryUsingSshAsync, runGitCloneAsync } from '../../../onboarding/git';
import { installDependenciesAsync } from '../../../onboarding/installDependencies';
import { runCommandAsync } from '../../../onboarding/runCommand';
import {
  cloneTemplateAsync,
  initializeGitRepositoryAsync,
  installProjectDependenciesAsync,
} from '../commands';

jest.mock('../../../onboarding/git');
jest.mock('../../../onboarding/runCommand');
jest.mock('../../../onboarding/installDependencies');
jest.mock('../../../ora');
jest.mock('fs-extra');

describe('commands', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('cloneTemplateAsync', () => {
    it('should clone the template project with ssh', async () => {
      const targetProjectDir = '/test/target-project';
      const finalTargetProjectDir = '/test/final-target-project';

      jest.mocked(canAccessRepositoryUsingSshAsync).mockResolvedValue(true);
      jest.mocked(runGitCloneAsync).mockResolvedValue({
        targetProjectDir: finalTargetProjectDir,
      });

      const result = await cloneTemplateAsync(targetProjectDir);

      expect(runGitCloneAsync).toHaveBeenCalledWith({
        githubUsername: 'expo',
        githubRepositoryName: 'expo-template-default',
        targetProjectDir,
        cloneMethod: 'ssh',
        showOutput: false,
      });

      expect(result).toBe(finalTargetProjectDir);
    });

    it('should clone the template project with https', async () => {
      const targetProjectDir = '/test/target-project';
      const finalTargetProjectDir = '/test/final-target-project';

      jest.mocked(canAccessRepositoryUsingSshAsync).mockResolvedValue(false);
      jest.mocked(runGitCloneAsync).mockResolvedValue({
        targetProjectDir: finalTargetProjectDir,
      });

      const result = await cloneTemplateAsync(targetProjectDir);

      expect(runGitCloneAsync).toHaveBeenCalledWith({
        githubUsername: 'expo',
        githubRepositoryName: 'expo-template-default',
        targetProjectDir,
        cloneMethod: 'https',
        showOutput: false,
      });

      expect(result).toBe(finalTargetProjectDir);
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

      expect(runCommandAsync).toHaveBeenCalledWith({
        cwd: projectDir,
        command: 'npx',
        args: ['expo', 'install', 'expo-updates'],
        showOutput: false,
        showSpinner: false,
      });

      expect(runCommandAsync).toHaveBeenCalledWith({
        cwd: projectDir,
        command: 'npx',
        args: ['expo', 'install', '@expo/metro-runtime'],
        showOutput: false,
        showSpinner: false,
      });
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
