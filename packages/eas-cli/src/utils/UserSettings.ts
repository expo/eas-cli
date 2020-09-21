import JsonFile from '@expo/json-file';
import path from 'path';

import { getConfigDirectory } from './paths';

const SETTINGS_FILE_PATH = path.join(getConfigDirectory(), 'user-settings.json');

export type UserSettingsData = {
  appleId?: string;
};

const UserSettings: JsonFile<UserSettingsData> = new JsonFile<UserSettingsData>(
  SETTINGS_FILE_PATH,
  {
    jsonParseErrorDefault: {},
    cantReadFileDefault: {},
    ensureDir: true,
  }
);

export default UserSettings;
