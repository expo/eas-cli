import envPaths from 'env-paths';
import { homedir } from 'os';
import * as path from 'path';

// The ~/.expo directory is used to store authentication sessions,
// which are shared between EAS CLI and Expo CLI.
function dotExpoHomeDirectory(): string {
  const home = homedir();
  if (!home) {
    throw new Error(
      "Can't determine your home directory; make sure your $HOME environment variable is set."
    );
  }

  let dirPath;
  if (process.env.EXPO_STAGING) {
    dirPath = path.join(home, '.expo-staging');
  } else if (process.env.EXPO_LOCAL) {
    dirPath = path.join(home, '.expo-local');
  } else {
    dirPath = path.join(home, '.expo');
  }
  return dirPath;
}

const getStateJsonPath = (): string => path.join(dotExpoHomeDirectory(), 'state.json');

// Paths for storing things like data, config, cache, etc.
// Should use the correct OS-specific paths (e.g. XDG base directory on Linux)
const {
  data: DATA_PATH,
  config: CONFIG_PATH,
  cache: CACHE_PATH,
  log: LOG_PATH,
  temp: TEMP_PATH,
} = envPaths('eas-cli');

const getDataDirectory = (): string => DATA_PATH;
const getConfigDirectory = (): string => CONFIG_PATH;
const getCacheDirectory = (): string => CACHE_PATH;
const getLogDirectory = (): string => LOG_PATH;
const getTmpDirectory = (): string => TEMP_PATH;

export {
  getDataDirectory,
  getConfigDirectory,
  getCacheDirectory,
  getLogDirectory,
  getTmpDirectory,
  getStateJsonPath,
};
