import JsonFileModule from '@expo/json-file';
import path from 'path';

import { getConfigDirectory } from '../utils/paths.js';

const JsonFile = JsonFileModule.default;

const SETTINGS_FILE_PATH = path.join(getConfigDirectory(), 'user-settings.json');

export type UserSettingsData = {
  appleId?: string;
  amplitudeDeviceId?: string;
  amplitudeEnabled?: boolean;
  analyticsDeviceId?: string;
  analyticsEnabled?: boolean;
};

const UserSettings = new JsonFile<UserSettingsData>(SETTINGS_FILE_PATH, {
  jsonParseErrorDefault: {},
  cantReadFileDefault: {},
  ensureDir: true,
});

export default UserSettings;
