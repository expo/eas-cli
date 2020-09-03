import envPaths from 'env-paths';

// Paths for storing things like data, config, cache, etc.
// Should use the correct OS-specific paths (e.g. XDG base directory on Linux)
const { data, config, cache, log, temp } = envPaths('eas-cli');

export {
  data as DATA_PATH,
  config as CONFIG_PATH,
  cache as CACHE_PATH,
  log as LOG_PATH,
  temp as TEMP_PATH,
};
