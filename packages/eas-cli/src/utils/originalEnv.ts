import { LOADED_ENV_NAME } from '@expo/env';

// TODO(@ramonclaudio): Use `getOriginalEnv()` from `@expo/env` after EAS CLI
// requires Node 20.12.0 or newer.
/** Remove dotenv values listed by an inherited `__EXPO_ENV_LOADED` marker. */
export function getEnvWithoutInheritedDotenvValues(env: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  const result = { ...env };
  const loadedKeys = getLoadedEnvKeys(result[LOADED_ENV_NAME]);
  const unsafeAllowedKeys = loadedKeys.includes('EXPO_UNSAFE_DOTENV_KEYS')
    ? new Set<string>()
    : new Set(result.EXPO_UNSAFE_DOTENV_KEYS?.split(',').filter(key => key.length > 0));

  for (const key of loadedKeys) {
    if (!unsafeAllowedKeys.has(key)) {
      delete result[key];
    }
  }
  delete result[LOADED_ENV_NAME];
  return result;
}

function getLoadedEnvKeys(marker: string | undefined): string[] {
  if (!marker) {
    return [];
  }
  try {
    const loadedKeys = JSON.parse(marker);
    return Array.isArray(loadedKeys)
      ? loadedKeys.filter((key): key is string => typeof key === 'string')
      : [];
  } catch {
    return [];
  }
}
