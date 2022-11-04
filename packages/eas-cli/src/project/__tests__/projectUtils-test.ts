import { getPackageJson } from '@expo/config';
import { ExpoConfig } from '@expo/config-types';

import * as projectUtils from '../projectUtils';

jest.mock('@expo/config', () => ({
  getPackageJson: jest.fn(),
}));

describe(projectUtils.isEASUpdateConfigured, () => {
  describe('expo-updates is not installed', () => {
    it('returns false if updates.url is not set', () => {
      jest.mocked(getPackageJson).mockReturnValue({});

      const exp: ExpoConfig = {
        name: 'blah',
        slug: 'blah',
      };
      expect(projectUtils.isEASUpdateConfigured('/path/to/project', exp)).toBe(false);
    });

    it('returns false if updates.url is set', () => {
      jest.mocked(getPackageJson).mockReturnValue({});

      const exp: ExpoConfig = {
        name: 'blah',
        slug: 'blah',
        updates: { url: 'http://sokal.dev/todo' },
      };
      expect(projectUtils.isEASUpdateConfigured('/path/to/project', exp)).toBe(false);
    });

    it('returns true if updates.url is set (for SDK < 44)', () => {
      jest.mocked(getPackageJson).mockReturnValue({});

      const exp: ExpoConfig = {
        name: 'blah',
        slug: 'blah',
        sdkVersion: '43.0.0',
        updates: { url: 'http://sokal.dev/todo' },
      };
      expect(projectUtils.isEASUpdateConfigured('/path/to/project', exp)).toBe(true);
    });
  });

  describe('expo-updates is installed', () => {
    it('returns false if updates.url is not set', () => {
      jest.mocked(getPackageJson).mockReturnValue({
        dependencies: {
          'expo-updates': '1.2.3',
        },
      });

      const exp: ExpoConfig = {
        name: 'blah',
        slug: 'blah',
      };
      expect(projectUtils.isEASUpdateConfigured('/path/to/project', exp)).toBe(false);
    });

    it('returns true if updates.url is set', () => {
      jest.mocked(getPackageJson).mockReturnValue({
        dependencies: {
          'expo-updates': '1.2.3',
        },
      });

      const exp: ExpoConfig = {
        name: 'blah',
        slug: 'blah',
        updates: { url: 'http://sokal.dev/todo' },
      };
      expect(projectUtils.isEASUpdateConfigured('/path/to/project', exp)).toBe(true);
    });
  });
});
