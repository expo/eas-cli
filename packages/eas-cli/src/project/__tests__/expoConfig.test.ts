import { getConfig, getConfigFilePaths, getPackageJson, modifyConfigAsync } from '@expo/config';
import JsonFile from '@expo/json-file';
import { writeFileSync } from 'fs-extra';
import resolveFrom from 'resolve-from';

import { createOrModifyExpoConfigAsync, getPrivateExpoConfigAsync } from '../expoConfig';
import { isExpoInstalled } from '../projectUtils';

jest.mock('fs-extra');
jest.mock('@expo/config');
jest.mock('@expo/json-file');
jest.mock('resolve-from', () => {
  const resolveFrom: any = jest.fn();
  resolveFrom.silent = jest.fn();
  return resolveFrom;
});
jest.mock('../projectUtils');

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

  describe('getPrivateExpoConfigAsync when Expo CLI is not resolvable', () => {
    const pluginNotFoundError = Object.assign(
      new Error(
        'Failed to resolve plugin for module "expo-router" relative to "/app". Do you have node modules installed?'
      ),
      { code: 'PLUGIN_NOT_FOUND' }
    );

    beforeEach(() => {
      jest.mocked(getConfigFilePaths).mockReturnValue({
        staticConfigPath: '/app/app.json',
        dynamicConfigPath: null,
      });
      jest.mocked(isExpoInstalled).mockReturnValue(false);
    });

    it('throws an actionable error when dependencies are not installed and a config plugin cannot be resolved', async () => {
      // `expo` is declared in package.json but dependencies are not installed
      jest.mocked(getPackageJson).mockReturnValue({ dependencies: { expo: '~53.0.0' } } as any);
      jest.mocked(resolveFrom.silent).mockReturnValue(undefined);
      jest.mocked(getConfig).mockImplementation(() => {
        throw pluginNotFoundError;
      });

      await expect(getPrivateExpoConfigAsync('/app')).rejects.toThrow(
        /dependencies aren't installed/
      );
    });

    it('throws an actionable error when dependencies are not installed and a dynamic config cannot be evaluated', async () => {
      jest.mocked(getPackageJson).mockReturnValue({ dependencies: { expo: '~53.0.0' } } as any);
      jest.mocked(resolveFrom.silent).mockReturnValue(undefined);
      jest.mocked(getConfig).mockImplementation(() => {
        throw new Error("Cannot find module 'dotenv/config'");
      });

      await expect(getPrivateExpoConfigAsync('/app')).rejects.toThrow(
        /dependencies aren't installed/
      );
    });

    it('rethrows the original error when expo is not declared in package.json', async () => {
      jest.mocked(getPackageJson).mockReturnValue({ dependencies: {} } as any);
      jest.mocked(resolveFrom.silent).mockReturnValue(undefined);
      jest.mocked(getConfig).mockImplementation(() => {
        throw pluginNotFoundError;
      });

      await expect(getPrivateExpoConfigAsync('/app')).rejects.toThrow(pluginNotFoundError.message);
      expect(getConfig).toHaveBeenCalledTimes(1);
    });

    it('rethrows the original error when dependencies are installed', async () => {
      jest.mocked(getPackageJson).mockReturnValue({ dependencies: { expo: '~53.0.0' } } as any);
      jest.mocked(resolveFrom.silent).mockReturnValue('/app/node_modules/expo/package.json');
      jest.mocked(getConfig).mockImplementation(() => {
        throw pluginNotFoundError;
      });

      await expect(getPrivateExpoConfigAsync('/app')).rejects.toThrow(pluginNotFoundError.message);
      expect(getConfig).toHaveBeenCalledTimes(1);
    });
  });
});
