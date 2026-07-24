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
    beforeEach(() => {
      jest.mocked(getConfigFilePaths).mockReturnValue({
        staticConfigPath: '/app/app.json',
        dynamicConfigPath: null,
      });
      jest.mocked(isExpoInstalled).mockReturnValue(false);
    });

    it('throws an actionable error when expo is declared in package.json but not installed', async () => {
      jest.mocked(getPackageJson).mockReturnValue({ dependencies: { expo: '~53.0.0' } } as any);
      jest.mocked(resolveFrom.silent).mockReturnValue(undefined);

      await expect(getPrivateExpoConfigAsync('/app')).rejects.toThrow(
        /dependencies to be installed/
      );
      expect(getConfig).not.toHaveBeenCalled();
    });

    it('reads the config with the bundled @expo/config when expo is not declared in package.json', async () => {
      const exp = { name: 'testapp', slug: 'testapp' } as any;
      jest.mocked(getPackageJson).mockReturnValue({ dependencies: {} } as any);
      jest.mocked(getConfig).mockReturnValue({ exp } as any);

      await expect(getPrivateExpoConfigAsync('/app')).resolves.toEqual(exp);
    });
  });
});
