import { CONFIG_PLUGIN, SDK_PACKAGES } from '../sdk';

describe('Supabase SDK constants', () => {
  it('lists the packages and plugin connect installs', () => {
    expect(SDK_PACKAGES).toEqual([
      '@supabase/supabase-js',
      'react-native-url-polyfill',
      'expo-sqlite',
    ]);
    expect(CONFIG_PLUGIN).toBe('expo-sqlite');
  });
});
