import JsonFile from '@expo/json-file';
import path from 'path';

import { configDirectory } from './paths';

const SETTINGS_FILE_PATH = path.join(configDirectory(), 'user-settings.json');

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
