import { getConfigFilePaths, modifyConfigAsync } from '@expo/config';
import JsonFile from '@expo/json-file';
import fs, { writeFileSync } from 'fs-extra';

import { createOrModifyExpoConfigAsync, getPrivateExpoConfigAsync } from '../expoConfig';
import { isExpoInstalled } from '../projectUtils';
import { spawnExpoCommand } from '../../utils/expoCli';

jest.mock('fs-extra');
jest.mock('@expo/config');
jest.mock('@expo/json-file');
jest.mock('../projectUtils');
jest.mock('../../utils/expoCli');

beforeEach(() => {
  jest.resetAllMocks();
});

describe('expoConfig', () => {
  describe('createOrModifyExpoConfigAsync', () => {
    it('should create a new app config file if it does not exist', async () => {
      jest.mocked(getConfigFilePaths).mockReturnValue({
        staticConfigPath: null,
        dynamicConfigPath: null,
      });

      await createOrModifyExpoConfigAsync('/app', {});
      expect(writeFileSync).toHaveBeenCalledWith('/app/app.json', '{\n  "expo": {}\n}');
    });

    it('should delegate to modifyConfigAsync if ', async () => {
      jest.mocked(getConfigFilePaths).mockReturnValue({
        staticConfigPath: '/app/app.json',
        dynamicConfigPath: null,
      });
      jest.mocked(JsonFile.readAsync).mockResolvedValue({ expo: {} });

      await createOrModifyExpoConfigAsync('/app', {});
      // modifyConfigAsync is mocked so this shouldn't be called
      expect(writeFileSync).not.toHaveBeenCalled();
    });

    it('should modify an existing config file if it exists', async () => {
      jest.mocked(getConfigFilePaths).mockReturnValue({
        staticConfigPath: '/app/app.json',
        dynamicConfigPath: null,
      });
      jest.mocked(JsonFile.readAsync).mockResolvedValue({ expo: {} });

      await createOrModifyExpoConfigAsync('/app', { owner: 'ccheever' });
      expect(modifyConfigAsync).toHaveBeenCalledWith('/app', { owner: 'ccheever' });
    });
  });

  describe('getPrivateExpoConfigAsync', () => {
    function mockExpoCommandFailure(stderr: string): void {
      jest.mocked(isExpoInstalled).mockReturnValue(true);
      jest
        .mocked(spawnExpoCommand)
        .mockRejectedValue(
          Object.assign(
            new Error('/app/node_modules/expo/bin/cli config --json exited with non-zero code: 1'),
            { stdout: '', stderr, status: 1 }
          ) as any
        );
    }

    it('surfaces the stderr of a failed expo config command', async () => {
      mockExpoCommandFailure('Something went wrong reading app.config.ts');
      jest.mocked(fs.existsSync).mockReturnValue(true);

      // Without this the caller only sees "exited with non-zero code: 1" and the
      // reason the CLI printed is dropped.
      await expect(getPrivateExpoConfigAsync('/app')).rejects.toThrow(
        'Something went wrong reading app.config.ts'
      );
    });

    it('points at the dependencies when the expo config command cannot resolve a module', async () => {
      mockExpoCommandFailure("Error: Cannot find module 'expo-updates'");
      jest.mocked(fs.existsSync).mockReturnValue(true);

      await expect(getPrivateExpoConfigAsync('/app')).rejects.toThrow(
        'dependencies look missing or incomplete'
      );
    });

    it('points at the dependencies when node_modules is absent, whatever the CLI printed', async () => {
      mockExpoCommandFailure('some unrelated failure');
      jest.mocked(fs.existsSync).mockReturnValue(false);

      await expect(getPrivateExpoConfigAsync('/app')).rejects.toThrow(
        'dependencies look missing or incomplete'
      );
    });

    it('does not blame the dependencies when they are installed and the failure is unrelated', async () => {
      mockExpoCommandFailure('some unrelated failure');
      jest.mocked(fs.existsSync).mockReturnValue(true);

      await expect(getPrivateExpoConfigAsync('/app')).rejects.toThrow(
        expect.objectContaining({
          message: expect.not.stringContaining('dependencies look missing or incomplete'),
        }) as Error
      );
    });
  });
});
