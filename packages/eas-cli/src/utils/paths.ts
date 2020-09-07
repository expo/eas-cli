import envPaths from 'env-paths';
import * as path from 'path';

// Paths for storing things like data, config, cache, etc.
// Should use the correct OS-specific paths (e.g. XDG base directory on Linux)
const {
  data: DATA_PATH,
  config: CONFIG_PATH,
  cache: CACHE_PATH,
  log: LOG_PATH,
  temp: TEMP_PATH,
} = envPaths('eas-cli');

const SESSION_PATH = path.join(DATA_PATH, 'session.json');

export { DATA_PATH, CONFIG_PATH, CACHE_PATH, LOG_PATH, TEMP_PATH, SESSION_PATH };
