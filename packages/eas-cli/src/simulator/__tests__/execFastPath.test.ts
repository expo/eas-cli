import spawnAsync from '@expo/spawn-async';
import fs from 'fs-extra';
import os from 'os';
import path from 'path';

import Log from '../../log';
import { loadSimulatorEnvAsync } from '../env';
import {
  isSimulatorExecFastPathArgv,
  parseSimulatorExecArgv,
  resolveSimulatorExecProjectDirAsync,
  runSimulatorExecFastPathAsync,
} from '../execFastPath';

jest.mock('@expo/spawn-async');
jest.mock('../env', () => ({
  loadSimulatorEnvAsync: jest.fn(),
}));
jest.mock('../../log', () => ({
  __esModule: true,
  default: {
    errorToStderr: jest.fn(),
    warn: jest.fn(),
  },
}));

describe('execFastPath', () => {
  const originalExitCode = process.exitCode;
  const originalParentCommand = process.env.__EXPO_PARENT_COMMAND;
  const originalSkipVersionCheck = process.env.EAS_SKIP_CLI_VERSION_CHECK;
  const originalNoVcs = process.env.EAS_NO_VCS;
  const originalProjectRoot = process.env.EAS_PROJECT_ROOT;
  const originalGitDir = process.env.GIT_DIR;
  const originalGitWorkTree = process.env.GIT_WORK_TREE;

  let tempRoot: string;
  let projectDir: string;

  beforeEach(async () => {
    jest.clearAllMocks();
    process.exitCode = undefined;
    delete process.env.__EXPO_PARENT_COMMAND;
    delete process.env.EAS_SKIP_CLI_VERSION_CHECK;
    delete process.env.EAS_NO_VCS;
    delete process.env.EAS_PROJECT_ROOT;
    delete process.env.GIT_DIR;
    delete process.env.GIT_WORK_TREE;

    tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'eas-sim-exec-fast-path-'));
    projectDir = path.join(tempRoot, 'app');
    await fs.ensureDir(projectDir);
    await fs.writeJson(path.join(projectDir, 'package.json'), { name: 'test-app' });

    jest.mocked(loadSimulatorEnvAsync).mockResolvedValue();
    jest.mocked(spawnAsync).mockResolvedValue({} as never);
  });

  afterEach(async () => {
    process.exitCode = originalExitCode;
    if (originalParentCommand === undefined) {
      delete process.env.__EXPO_PARENT_COMMAND;
    } else {
      process.env.__EXPO_PARENT_COMMAND = originalParentCommand;
    }
    if (originalSkipVersionCheck === undefined) {
      delete process.env.EAS_SKIP_CLI_VERSION_CHECK;
    } else {
      process.env.EAS_SKIP_CLI_VERSION_CHECK = originalSkipVersionCheck;
    }
    if (originalNoVcs === undefined) {
      delete process.env.EAS_NO_VCS;
    } else {
      process.env.EAS_NO_VCS = originalNoVcs;
    }
    if (originalProjectRoot === undefined) {
      delete process.env.EAS_PROJECT_ROOT;
    } else {
      process.env.EAS_PROJECT_ROOT = originalProjectRoot;
    }
    if (originalGitDir === undefined) {
      delete process.env.GIT_DIR;
    } else {
      process.env.GIT_DIR = originalGitDir;
    }
    if (originalGitWorkTree === undefined) {
      delete process.env.GIT_WORK_TREE;
    } else {
      process.env.GIT_WORK_TREE = originalGitWorkTree;
    }
    await fs.remove(tempRoot);
  });

  describe('isSimulatorExecFastPathArgv', () => {
    it.each(['simulator:exec', 'sim:exec', 'simulators:exec', 'emulator:exec', 'emulators:exec'])(
      'matches %s invocations without help flags',
      commandId => {
        expect(isSimulatorExecFastPathArgv([commandId, 'echo', 'ok'])).toBe(true);
        expect(isSimulatorExecFastPathArgv([commandId])).toBe(true);
      }
    );

    it('falls through to oclif for --help and -h', () => {
      expect(isSimulatorExecFastPathArgv(['simulator:exec', '--help'])).toBe(false);
      expect(isSimulatorExecFastPathArgv(['sim:exec', '-h'])).toBe(false);
      expect(isSimulatorExecFastPathArgv(['simulator:exec', 'echo', '--help'])).toBe(false);
    });

    it('does not treat help flags after -- as oclif help', () => {
      expect(isSimulatorExecFastPathArgv(['simulator:exec', '--', 'echo', '--help'])).toBe(true);
    });

    it('does not match non-exec commands', () => {
      expect(isSimulatorExecFastPathArgv([])).toBe(false);
      expect(isSimulatorExecFastPathArgv(['simulator:list'])).toBe(false);
      expect(isSimulatorExecFastPathArgv(['build'])).toBe(false);
    });
  });

  describe('parseSimulatorExecArgv', () => {
    it('extracts command and args', () => {
      expect(parseSimulatorExecArgv(['agent-device', 'touch', '@e2'])).toEqual({
        command: 'agent-device',
        args: ['touch', '@e2'],
      });
    });

    it('strips a single leading -- separator', () => {
      expect(parseSimulatorExecArgv(['--', 'echo', '--help'])).toEqual({
        command: 'echo',
        args: ['--help'],
      });
    });

    it('throws when no command is provided', () => {
      expect(() => parseSimulatorExecArgv([])).toThrow(
        'No command provided. Run `eas simulator:exec <command> [args...]`.'
      );
      expect(() => parseSimulatorExecArgv(['--'])).toThrow(
        'No command provided. Run `eas simulator:exec <command> [args...]`.'
      );
    });
  });

  describe('resolveSimulatorExecProjectDirAsync', () => {
    it('resolves the project directory from the project root and nested subdirectories', async () => {
      const nestedDir = path.join(projectDir, 'src', 'components');
      await fs.ensureDir(nestedDir);

      expect(await resolveSimulatorExecProjectDirAsync(projectDir)).toBe(projectDir);
      expect(await resolveSimulatorExecProjectDirAsync(nestedDir)).toBe(projectDir);
    });

    it('rejects running outside a project directory', async () => {
      const outsideDir = path.join(tempRoot, 'no-project');
      await fs.ensureDir(outsideDir);

      await expect(resolveSimulatorExecProjectDirAsync(outsideDir)).rejects.toThrow(
        'Run this command inside a project directory.'
      );
    });

    it('rejects a nested Git repository directory without its own package.json', async () => {
      const nestedRepoDir = path.join(projectDir, 'automation');
      const nestedRepoSubdir = path.join(nestedRepoDir, 'scripts');
      await fs.ensureDir(path.join(nestedRepoDir, '.git'));
      await fs.ensureDir(nestedRepoSubdir);

      await expect(resolveSimulatorExecProjectDirAsync(nestedRepoSubdir)).rejects.toThrow(
        `package.json is outside of the current git repository (project root: ${projectDir}, git root: ${nestedRepoDir}.`
      );
    });

    it('rejects a nested Git worktree (.git file) without its own package.json', async () => {
      const worktreeDir = path.join(projectDir, 'worktree');
      await fs.ensureDir(worktreeDir);
      await fs.writeFile(path.join(worktreeDir, '.git'), 'gitdir: /some/other/repo/.git\n');

      await expect(resolveSimulatorExecProjectDirAsync(worktreeDir)).rejects.toThrow(
        `package.json is outside of the current git repository (project root: ${projectDir}, git root: ${worktreeDir}.`
      );
    });

    it('rejects nested EAS_PROJECT_ROOT overrides including names starting with ..', async () => {
      const childDir = path.join(projectDir, '..automation');
      await fs.ensureDir(childDir);
      process.env.EAS_NO_VCS = '1';
      process.env.EAS_PROJECT_ROOT = childDir;

      await expect(resolveSimulatorExecProjectDirAsync(childDir)).rejects.toThrow(
        `package.json is outside of the current git repository (project root: ${projectDir}, git root: ${childDir}.`
      );
    });

    it('allows a .git directory at the project root itself', async () => {
      await fs.ensureDir(path.join(projectDir, '.git'));
      const nestedDir = path.join(projectDir, 'src');
      await fs.ensureDir(nestedDir);

      expect(await resolveSimulatorExecProjectDirAsync(nestedDir)).toBe(projectDir);
    });

    it('enforces eas.json cli.version constraints and honors EAS_SKIP_CLI_VERSION_CHECK', async () => {
      await fs.writeJson(path.join(projectDir, 'eas.json'), {
        cli: { version: '0.0.1' },
      });

      await expect(resolveSimulatorExecProjectDirAsync(projectDir)).rejects.toThrow(
        'does not satisfy the CLI version constraint defined in eas.json (0.0.1)'
      );

      process.env.EAS_SKIP_CLI_VERSION_CHECK = '1';
      expect(await resolveSimulatorExecProjectDirAsync(projectDir)).toBe(projectDir);
    });

    it('rejects schema-invalid cli.version values and malformed eas.json even when version check is skipped', async () => {
      await fs.writeJson(path.join(projectDir, 'eas.json'), {
        cli: { version: 42 },
      });

      await expect(resolveSimulatorExecProjectDirAsync(projectDir)).rejects.toThrow(
        '"cli.version" must be a string'
      );

      await fs.writeFile(path.join(projectDir, 'eas.json'), '{');
      process.env.EAS_SKIP_CLI_VERSION_CHECK = '1';

      await expect(resolveSimulatorExecProjectDirAsync(projectDir)).rejects.toThrow();
    });

    it('supports JSON5 eas.json files with comments for cli.version checks', async () => {
      await fs.writeFile(
        path.join(projectDir, 'eas.json'),
        `{\n  // pin CLI version\n  "cli": { "version": "0.0.1" },\n}\n`
      );

      await expect(resolveSimulatorExecProjectDirAsync(projectDir)).rejects.toThrow(
        'does not satisfy the CLI version constraint defined in eas.json (0.0.1)'
      );
    });
  });

  describe('runSimulatorExecFastPathAsync', () => {
    it('loads simulator env, sets and restores __EXPO_PARENT_COMMAND, and spawns the command', async () => {
      process.env.__EXPO_PARENT_COMMAND = 'expo run:ios';
      let observedParentCommand: string | undefined;
      jest.mocked(spawnAsync).mockImplementation(() => {
        observedParentCommand = process.env.__EXPO_PARENT_COMMAND;
        return Promise.resolve({} as never) as never;
      });

      await runSimulatorExecFastPathAsync(['agent-device', 'touch', '@e2'], { cwd: projectDir });

      expect(loadSimulatorEnvAsync).toHaveBeenCalledWith(projectDir);
      expect(observedParentCommand).toBe('eas simulator:exec');
      expect(process.env.__EXPO_PARENT_COMMAND).toBe('expo run:ios');
      expect(spawnAsync).toHaveBeenCalledWith(
        'agent-device',
        ['touch', '@e2'],
        expect.objectContaining({
          stdio: 'inherit',
          env: process.env,
        })
      );
      expect(process.exitCode).toBeUndefined();
    });

    it('strips leading -- and passes --help through to the wrapped command', async () => {
      await runSimulatorExecFastPathAsync(['--', 'echo', '--help'], { cwd: projectDir });

      expect(spawnAsync).toHaveBeenCalledWith(
        'echo',
        ['--help'],
        expect.objectContaining({
          stdio: 'inherit',
          env: process.env,
        })
      );
      expect(process.exitCode).toBeUndefined();
    });

    it('prints an error and sets exitCode 1 when no command is provided', async () => {
      await runSimulatorExecFastPathAsync([], { cwd: projectDir });

      expect(Log.errorToStderr).toHaveBeenCalledWith(
        'No command provided. Run `eas simulator:exec <command> [args...]`.'
      );
      expect(process.exitCode).toBe(1);
      expect(loadSimulatorEnvAsync).not.toHaveBeenCalled();
      expect(spawnAsync).not.toHaveBeenCalled();
    });

    it('stops before loading dotenv or spawning when in a nested Git checkout', async () => {
      const nestedRepoDir = path.join(projectDir, 'nested-repo');
      await fs.ensureDir(path.join(nestedRepoDir, '.git'));

      await runSimulatorExecFastPathAsync(['echo', 'ok'], { cwd: nestedRepoDir });

      expect(Log.errorToStderr).toHaveBeenCalledWith(
        expect.stringContaining('package.json is outside of the current git repository')
      );
      expect(process.exitCode).toBe(1);
      expect(loadSimulatorEnvAsync).not.toHaveBeenCalled();
      expect(spawnAsync).not.toHaveBeenCalled();
    });

    it('stops before loading dotenv or spawning when eas.json cli.version does not match', async () => {
      await fs.writeJson(path.join(projectDir, 'eas.json'), {
        cli: { version: '0.0.1' },
      });

      await runSimulatorExecFastPathAsync(['echo', 'ok'], { cwd: projectDir });

      expect(Log.errorToStderr).toHaveBeenCalledWith(
        expect.stringContaining('does not satisfy the CLI version constraint')
      );
      expect(process.exitCode).toBe(1);
      expect(loadSimulatorEnvAsync).not.toHaveBeenCalled();
      expect(spawnAsync).not.toHaveBeenCalled();
    });

    it('propagates non-zero subprocess exit codes without extra stderr output', async () => {
      const error = Object.assign(new Error('Command failed'), { status: 42, signal: null });
      jest.mocked(spawnAsync).mockRejectedValue(error);

      await runSimulatorExecFastPathAsync(['sh', '-c', 'exit 42'], { cwd: projectDir });

      expect(Log.errorToStderr).not.toHaveBeenCalled();
      expect(process.exitCode).toBe(42);
    });

    it.each([
      ['ENOENT', 'spawn missing-bin ENOENT'],
      ['EACCES', 'spawn ./not-exec.sh EACCES'],
      ['EPERM', 'spawn ./blocked EPERM'],
    ])('prints OS diagnostic and sets exitCode 1 on %s spawn errors', async (code, message) => {
      const error = Object.assign(new Error(message), {
        code,
        status: null,
        signal: null,
      });
      jest.mocked(spawnAsync).mockRejectedValue(error);

      await runSimulatorExecFastPathAsync(['cmd'], { cwd: projectDir });

      expect(Log.errorToStderr).toHaveBeenCalledWith(message);
      expect(process.exitCode).toBe(1);
    });

    it('maps child termination signals to POSIX 128 + signal exit codes', async () => {
      const error = Object.assign(new Error('child exited with signal: SIGTERM'), {
        status: null,
        signal: 'SIGTERM',
      });
      jest.mocked(spawnAsync).mockRejectedValue(error);

      await runSimulatorExecFastPathAsync(['sleep', '10'], { cwd: projectDir });

      expect(Log.errorToStderr).not.toHaveBeenCalled();
      expect(process.exitCode).toBe(128 + os.constants.signals.SIGTERM);
    });

    it('uses a detached child group and forwards SIGINT/SIGTERM/SIGHUP on non-TTY POSIX runs', async () => {
      const kill = jest.fn();
      const processKillSpy = jest.spyOn(process, 'kill').mockImplementation(() => true);
      let rejectChild!: (err: Error) => void;
      let resolveSpawnStarted!: () => void;
      const spawnStarted = new Promise<void>(resolve => {
        resolveSpawnStarted = resolve;
      });
      const childPromise = Object.assign(
        new Promise<never>((_, reject) => {
          rejectChild = reject;
        }),
        { child: { pid: 54321, kill } }
      );
      jest.mocked(spawnAsync).mockImplementation(() => {
        resolveSpawnStarted();
        return childPromise as never;
      });

      const sigtermListenersBefore = process.listenerCount('SIGTERM');
      const sigintListenersBefore = process.listenerCount('SIGINT');
      const runPromise = runSimulatorExecFastPathAsync(['sleep', '10'], {
        cwd: projectDir,
        isTTY: false,
      });

      try {
        await spawnStarted;

        if (process.platform !== 'win32') {
          expect(spawnAsync).toHaveBeenCalledWith(
            'sleep',
            ['10'],
            expect.objectContaining({ detached: true })
          );
          expect(process.listenerCount('SIGINT')).toBe(sigintListenersBefore + 1);
          expect(process.listenerCount('SIGTERM')).toBe(sigtermListenersBefore + 1);

          process.emit('SIGINT', 'SIGINT');
          expect(processKillSpy).toHaveBeenCalledWith(-54321, 'SIGINT');

          process.emit('SIGTERM', 'SIGTERM');
          expect(processKillSpy).toHaveBeenCalledWith(-54321, 'SIGTERM');
        }

        rejectChild(
          Object.assign(new Error('sleep 10 exited with signal: SIGTERM'), {
            status: null,
            signal: 'SIGTERM',
          })
        );
        await runPromise;

        expect(process.listenerCount('SIGTERM')).toBe(sigtermListenersBefore);
        expect(process.listenerCount('SIGINT')).toBe(sigintListenersBefore);
        expect(process.exitCode).toBe(128 + os.constants.signals.SIGTERM);
      } finally {
        processKillSpy.mockRestore();
      }
    });

    it('keeps child attached and avoids forwarding SIGINT on interactive TTYs', async () => {
      const kill = jest.fn();
      let rejectChild!: (err: Error) => void;
      let resolveSpawnStarted!: () => void;
      const spawnStarted = new Promise<void>(resolve => {
        resolveSpawnStarted = resolve;
      });
      const childPromise = Object.assign(
        new Promise<never>((_, reject) => {
          rejectChild = reject;
        }),
        { child: { pid: 54321, kill } }
      );
      jest.mocked(spawnAsync).mockImplementation(() => {
        resolveSpawnStarted();
        return childPromise as never;
      });

      const sigintListenersBefore = process.listenerCount('SIGINT');
      const runPromise = runSimulatorExecFastPathAsync(['sleep', '10'], {
        cwd: projectDir,
        isTTY: true,
      });

      await spawnStarted;

      expect(spawnAsync).toHaveBeenCalledWith('sleep', ['10'], {
        stdio: 'inherit',
        env: process.env,
      });
      expect(process.listenerCount('SIGINT')).toBe(sigintListenersBefore + 1);

      process.emit('SIGINT', 'SIGINT');
      expect(kill).not.toHaveBeenCalled();

      rejectChild(
        Object.assign(new Error('sleep 10 exited with signal: SIGINT'), {
          status: null,
          signal: 'SIGINT',
        })
      );
      await runPromise;

      expect(process.listenerCount('SIGINT')).toBe(sigintListenersBefore);
      expect(process.exitCode).toBe(128 + os.constants.signals.SIGINT);
    });
  });
});
