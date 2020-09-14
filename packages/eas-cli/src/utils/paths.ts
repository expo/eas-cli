import envPaths from 'env-paths';
import { mkdirSync } from 'fs';
import { homedir } from 'os';
import * as path from 'path';

// The ~/.expo directory is used to store authentication sessions,
// which are shared between EAS CLI and Expo CLI.
let homeCreated = false;
function dotExpoHomeDirectory() {
  let dirPath;
  if (process.env.__UNSAFE_EXPO_HOME_DIRECTORY) {
    dirPath = process.env.__UNSAFE_EXPO_HOME_DIRECTORY;
  } else {
    const home = homedir();
    if (!home) {
      throw new Error(
        "Can't determine your home directory; make sure your $HOME environment variable is set."
      );
    }

    if (process.env.EXPO_STAGING) {
      dirPath = path.join(home, '.expo-staging');
    } else if (process.env.EXPO_LOCAL) {
      dirPath = path.join(home, '.expo-local');
    } else {
      dirPath = path.join(home, '.expo');
    }
  }
  if (!homeCreated) {
    mkdirSync(dirPath, { recursive: true });
    homeCreated = true;
  }
  return dirPath;
}

const SETTINGS_FILE_PATH = path.join(dotExpoHomeDirectory(), 'state.json');

// Paths for storing things like data, config, cache, etc.
// Should use the correct OS-specific paths (e.g. XDG base directory on Linux)
const {
  data: DATA_PATH,
  config: CONFIG_PATH,
  cache: CACHE_PATH,
  log: LOG_PATH,
  temp: TEMP_PATH,
} = envPaths('eas-cli');

export { DATA_PATH, CONFIG_PATH, CACHE_PATH, LOG_PATH, TEMP_PATH, SETTINGS_FILE_PATH };
