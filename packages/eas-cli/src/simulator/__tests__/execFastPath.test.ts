import spawnAsync from '@expo/spawn-async';
import pkgDir from 'pkg-dir';

import Log from '../../log';
import { loadSimulatorEnvAsync } from '../env';
import { isSimulatorExecFastPathArgv, runSimulatorExecFastPathAsync } from '../execFastPath';

jest.mock('@expo/spawn-async');
jest.mock('pkg-dir');
jest.mock('../env', () => ({
  loadSimulatorEnvAsync: jest.fn(),
}));
jest.mock('../../log', () => ({
  __esModule: true,
  default: {
    errorToStderr: jest.fn(),
  },
}));

describe('execFastPath', () => {
  const originalExitCode = process.exitCode;

  beforeEach(() => {
    jest.clearAllMocks();
    process.exitCode = undefined;
    jest.mocked(pkgDir).mockResolvedValue('/test/project');
    jest.mocked(loadSimulatorEnvAsync).mockResolvedValue();
    jest.mocked(spawnAsync).mockResolvedValue({} as never);
  });

  afterEach(() => {
    process.exitCode = originalExitCode;
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

  describe('runSimulatorExecFastPathAsync', () => {
    it('loads simulator env and spawns the command with inherited stdio', async () => {
      await runSimulatorExecFastPathAsync(['agent-device', 'touch', '@e2']);

      expect(pkgDir).toHaveBeenCalledWith(undefined);
      expect(loadSimulatorEnvAsync).toHaveBeenCalledWith('/test/project');
      expect(spawnAsync).toHaveBeenCalledWith('agent-device', ['touch', '@e2'], {
        stdio: 'inherit',
        env: process.env,
      });
      expect(process.exitCode).toBeUndefined();
    });

    it('prints an error and sets exitCode 1 when no command is provided', async () => {
      await runSimulatorExecFastPathAsync([]);

      expect(Log.errorToStderr).toHaveBeenCalledWith(
        'No command provided. Run `eas simulator:exec <command> [args...]`.'
      );
      expect(process.exitCode).toBe(1);
      expect(loadSimulatorEnvAsync).not.toHaveBeenCalled();
      expect(spawnAsync).not.toHaveBeenCalled();
    });

    it('prints an error and sets exitCode 1 when run outside a project directory', async () => {
      jest.mocked(pkgDir).mockResolvedValue(undefined);

      await runSimulatorExecFastPathAsync(['echo', 'ok']);

      expect(Log.errorToStderr).toHaveBeenCalledWith(
        'Run this command inside a project directory.'
      );
      expect(process.exitCode).toBe(1);
      expect(loadSimulatorEnvAsync).not.toHaveBeenCalled();
      expect(spawnAsync).not.toHaveBeenCalled();
    });

    it('propagates non-zero subprocess exit codes without extra stderr output', async () => {
      const error = Object.assign(new Error('Command failed'), { status: 42 });
      jest.mocked(spawnAsync).mockRejectedValue(error);

      await runSimulatorExecFastPathAsync(['sh', '-c', 'exit 42']);

      expect(Log.errorToStderr).not.toHaveBeenCalled();
      expect(process.exitCode).toBe(42);
    });

    it('prints an error and sets exitCode 1 when the command binary is not found', async () => {
      const error = Object.assign(new Error('spawn missing-bin ENOENT'), {
        code: 'ENOENT',
        status: null,
      });
      jest.mocked(spawnAsync).mockRejectedValue(error);

      await runSimulatorExecFastPathAsync(['missing-bin']);

      expect(Log.errorToStderr).toHaveBeenCalledWith('spawn missing-bin ENOENT');
      expect(process.exitCode).toBe(1);
    });
  });
});
