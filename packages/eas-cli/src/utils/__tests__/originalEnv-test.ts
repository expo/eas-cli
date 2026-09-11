import { getEnvWithoutInheritedDotenvValues } from '../originalEnv';

describe(getEnvWithoutInheritedDotenvValues, () => {
  it('keeps a dotenv value allowed by the shell', () => {
    const env = {
      EXPO_UNSAFE_DOTENV_KEYS: 'ALLOWED_VALUE',
      ALLOWED_VALUE: 'keep',
      __EXPO_ENV_LOADED: '["ALLOWED_VALUE"]',
    };

    expect(getEnvWithoutInheritedDotenvValues(env)).toEqual({
      EXPO_UNSAFE_DOTENV_KEYS: 'ALLOWED_VALUE',
      ALLOWED_VALUE: 'keep',
    });
  });

  it('removes an unsafe-key list inherited from the parent process', () => {
    const env = {
      EXPO_UNSAFE_DOTENV_KEYS: 'DOTENV_VALUE',
      DOTENV_VALUE: 'remove',
      __EXPO_ENV_LOADED: '["EXPO_UNSAFE_DOTENV_KEYS","DOTENV_VALUE"]',
    };

    expect(getEnvWithoutInheritedDotenvValues(env)).toEqual({});
  });
});
