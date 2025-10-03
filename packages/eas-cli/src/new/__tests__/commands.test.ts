import Log from '../../log';
import { canAccessRepositoryUsingSshAsync, runGitCloneAsync } from '../../onboarding/git';
import { installDependenciesAsync } from '../../onboarding/installDependencies';
import { runCommandAsync } from '../../onboarding/runCommand';
import {
  cloneTemplateAsync,
  initializeGitRepositoryAsync,
  installProjectDependenciesAsync,
} from '../commands';

jest.mock('../../onboarding/git');
jest.mock('../../onboarding/runCommand');
jest.mock('../../onboarding/installDependencies');
jest.mock('fs-extra');

describe('commands', () => {
  let logSpy: jest.SpyInstance;

  beforeEach(() => {
    jest.clearAllMocks();
    logSpy = jest.spyOn(Log, 'log');
  });

  afterEach(() => {
    logSpy.mockRestore();
  });

  // Helper function to get all log output as strings
  const getLogOutput = (): string[] => {
    return logSpy.mock.calls.map(call => (call.length === 0 ? '' : call.join(' ')));
  };

  // Helper function to check if a specific message was logged
  const expectLogToContain = (message: string): void => {
    const output = getLogOutput();
    // strip out ANSI codes and special characters like the tick
    const outputWithoutAnsi = output.map(line =>
      line.replace(/\x1b\[[0-9;]*m/g, '').replace(/✔\s*/, '')
    );
    expect(outputWithoutAnsi.some(line => line.includes(message))).toBeTruthy();
  };

  describe('cloneTemplateAsync', () => {
    it('should clone the template project with ssh', async () => {
      const targetProjectDir = '/test/target-project';
      const finalTargetProjectDir = '/test/final-target-project';

      jest.mocked(canAccessRepositoryUsingSshAsync).mockResolvedValue(true);
      jest.mocked(runGitCloneAsync).mockResolvedValue({
        targetProjectDir: finalTargetProjectDir,
      });

      const result = await cloneTemplateAsync(targetProjectDir);

      expectLogToContain(`📂 Cloning the project to ${targetProjectDir}`);
      expectLogToContain('We detected that ssh is your preferred git clone method');

      expect(runGitCloneAsync).toHaveBeenCalledWith({
        githubUsername: 'expo',
        githubRepositoryName: 'expo-template-default',
        targetProjectDir,
        cloneMethod: 'ssh',
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

      expectLogToContain(`📂 Cloning the project to ${targetProjectDir}`);
      expectLogToContain('We detected that https is your preferred git clone method');

      expect(runGitCloneAsync).toHaveBeenCalledWith({
        githubUsername: 'expo',
        githubRepositoryName: 'expo-template-default',
        targetProjectDir,
        cloneMethod: 'https',
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
        projectDir,
        packageManager: 'npm',
      });

      expect(runCommandAsync).toHaveBeenCalledWith({
        cwd: projectDir,
        command: 'npx',
        args: ['expo', 'install', 'expo-updates'],
      });

      expect(runCommandAsync).toHaveBeenCalledWith({
        cwd: projectDir,
        command: 'npx',
        args: ['expo', 'install', '@expo/metro-runtime'],
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
      });

      expect(runCommandAsync).toHaveBeenCalledWith({
        command: 'git',
        args: ['add', '.'],
        cwd: projectDir,
      });

      expect(runCommandAsync).toHaveBeenCalledWith({
        command: 'git',
        args: ['commit', '-m', 'Initial commit'],
        cwd: projectDir,
      });
    });
  });
});
