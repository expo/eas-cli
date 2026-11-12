import { IOSConfig } from '@expo/config-plugins';
import resolveFrom from 'resolve-from';

import { sanitizedNameForProject } from '../sanitizedName';

jest.mock('resolve-from');

const projectDir = '/app';
const projectConfigPluginsPath = '/app/node_modules/expo/config-plugins.js';

// The SDK 58 sanitizer: letters keep their base form instead of being dropped.
const sdk58SanitizedName = (name: string): string =>
  name
    .replace(/[^\p{L}\p{N}]+/gu, '')
    .normalize('NFKD')
    .replace(/\p{M}+/gu, '');

jest.mock(
  '/app/node_modules/expo/config-plugins.js',
  () => ({ IOSConfig: { XcodeUtils: { sanitizedName: sdk58SanitizedName } } }),
  { virtual: true }
);

describe(sanitizedNameForProject, () => {
  beforeEach(() => {
    jest.mocked(resolveFrom.silent).mockReset();
  });

  it("uses the project's config-plugins, which prebuild names the target with", () => {
    jest.mocked(resolveFrom.silent).mockReturnValue(projectConfigPluginsPath);

    expect(sanitizedNameForProject(projectDir, 'Fotto Fotógrafos')).toBe('FottoFotografos');
    expect(resolveFrom.silent).toHaveBeenCalledWith(projectDir, 'expo/config-plugins');
  });

  it('differs from the bundled config-plugins for accented names', () => {
    expect(IOSConfig.XcodeUtils.sanitizedName('Fotto Fotógrafos')).toBe('FottoFotgrafos');
  });

  it('falls back to the bundled config-plugins when expo is not installed', () => {
    jest.mocked(resolveFrom.silent).mockReturnValue(undefined);

    expect(sanitizedNameForProject(projectDir, 'Fotto Fotógrafos')).toBe('FottoFotgrafos');
    expect(sanitizedNameForProject(projectDir, 'My App')).toBe('MyApp');
  });
});
