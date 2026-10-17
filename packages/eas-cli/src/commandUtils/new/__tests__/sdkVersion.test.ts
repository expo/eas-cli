import fetch from '../../../fetch';
import { promptAsync } from '../../../prompts';
import { fetchTemplatePackumentAsync } from '../commands';
import {
  fetchSdkVersionsAsync,
  promptForSdkVersionAsync,
  resolveTemplateAsync,
} from '../sdkVersion';

jest.mock('../../../fetch');
jest.mock('../../../prompts');
jest.mock('../../../api', () => ({
  getExpoApiBaseUrl: () => 'https://api.expo.dev',
}));
jest.mock('../commands');

const packument = {
  'dist-tags': { latest: '57.0.19', 'sdk-57': '57.0.19', 'sdk-56': '56.0.34' },
  versions: {
    '57.0.19': {
      dist: { tarball: 'https://registry.npmjs.org/expo-template-default/-/57.0.19.tgz' },
    },
    '56.0.34': {
      dist: { tarball: 'https://registry.npmjs.org/expo-template-default/-/56.0.34.tgz' },
    },
  },
};

function mockVersionsEndpoint(json: object): void {
  jest.mocked(fetch).mockResolvedValueOnce({ json: async () => json } as any);
}

beforeEach(() => {
  jest.clearAllMocks();
  jest.mocked(fetchTemplatePackumentAsync).mockResolvedValue(packument);
});

describe('fetchSdkVersionsAsync', () => {
  it('returns released SDK versions sorted descending', async () => {
    mockVersionsEndpoint({
      sdkVersions: {
        '55.0.0': { releaseNoteUrl: 'https://expo.dev/changelog/sdk-55' },
        '57.0.0': { releaseNoteUrl: 'https://expo.dev/changelog/sdk-57' },
        '56.0.0': { releaseNoteUrl: 'https://expo.dev/changelog/sdk-56' },
        '58.0.0': {}, // canary, no release notes
        '54.0.0': { releaseNoteUrl: 'https://expo.dev/changelog/sdk-54', isDeprecated: true },
      },
      expoGoSdkVersion: '56.0.0',
    });

    const versions = await fetchSdkVersionsAsync();

    expect(versions).toEqual({
      latest: 57,
      expoGoCompatible: 56,
      available: [57, 56, 55],
    });
  });

  it('returns null when the endpoint is unreachable', async () => {
    jest.mocked(fetch).mockRejectedValueOnce(new Error('network error'));

    expect(await fetchSdkVersionsAsync()).toBeNull();
  });

  it('returns null when no released versions are available', async () => {
    mockVersionsEndpoint({ sdkVersions: {} });

    expect(await fetchSdkVersionsAsync()).toBeNull();
  });
});

describe('promptForSdkVersionAsync', () => {
  it('offers latest and Expo Go compatible choices', async () => {
    jest.mocked(promptAsync).mockResolvedValueOnce({ answer: 56 });

    const result = await promptForSdkVersionAsync({
      latest: 57,
      expoGoCompatible: 56,
      available: [57, 56, 55],
    });

    expect(result).toBe(56);
    expect(promptAsync).toHaveBeenCalledWith(
      expect.objectContaining({
        message: 'Select an Expo SDK version:',
        choices: [
          expect.objectContaining({ title: 'Latest (SDK 57)', value: 57 }),
          expect.objectContaining({
            title: 'For learning with Expo Go (SDK 56)',
            value: 56,
          }),
          expect.objectContaining({ title: 'Other SDK version…', value: 'other' }),
        ],
      })
    );
  });

  it('hides the Expo Go choice when it matches the latest SDK or is unavailable', async () => {
    jest.mocked(promptAsync).mockResolvedValue({ answer: 57 });

    await promptForSdkVersionAsync({ latest: 57, expoGoCompatible: 57, available: [57, 56] });
    await promptForSdkVersionAsync({ latest: 57, expoGoCompatible: 54, available: [57, 56] });

    for (const call of jest.mocked(promptAsync).mock.calls) {
      expect(call[0]).toEqual(
        expect.objectContaining({
          choices: [
            expect.objectContaining({ title: 'Latest (SDK 57)' }),
            expect.objectContaining({ title: 'Other SDK version…' }),
          ],
        })
      );
    }
  });

  it('hides the "Other" choice when no other versions are available', async () => {
    jest.mocked(promptAsync).mockResolvedValueOnce({ answer: 57 });

    await promptForSdkVersionAsync({ latest: 57, expoGoCompatible: null, available: [57] });

    expect(promptAsync).toHaveBeenCalledWith(
      expect.objectContaining({
        choices: [expect.objectContaining({ title: 'Latest (SDK 57)' })],
      })
    );
  });

  it('offers the remaining versions when "other" is selected', async () => {
    jest
      .mocked(promptAsync)
      .mockResolvedValueOnce({ answer: 'other' })
      .mockResolvedValueOnce({ sdkVersion: 53 });

    const result = await promptForSdkVersionAsync({
      latest: 57,
      expoGoCompatible: 56,
      available: [57, 56, 55, 54, 53],
    });

    expect(result).toBe(53);
    expect(promptAsync).toHaveBeenLastCalledWith(
      expect.objectContaining({
        message: 'Select an SDK version:',
        choices: [
          { title: 'SDK 55', value: 55 },
          { title: 'SDK 54', value: 54 },
          { title: 'SDK 53', value: 53 },
        ],
      })
    );
  });
});

describe('resolveTemplateAsync', () => {
  it('uses the provided SDK version without prompting', async () => {
    expect(await resolveTemplateAsync({ sdkVersion: '56' })).toEqual({
      npmTag: 'sdk-56',
      version: '56.0.34',
      tarballUrl: 'https://registry.npmjs.org/expo-template-default/-/56.0.34.tgz',
    });
    expect((await resolveTemplateAsync({ sdkVersion: 'sdk-57' })).npmTag).toBe('sdk-57');
    expect((await resolveTemplateAsync({ sdkVersion: 'latest' })).npmTag).toBe('latest');
    expect(promptAsync).not.toHaveBeenCalled();
    expect(fetch).not.toHaveBeenCalled();
  });

  it('throws for an invalid SDK version', async () => {
    await expect(resolveTemplateAsync({ sdkVersion: 'abc' })).rejects.toThrow(
      'Invalid SDK version'
    );
  });

  it('throws for an SDK version without a published template', async () => {
    await expect(resolveTemplateAsync({ sdkVersion: '50' })).rejects.toThrow(
      'A project template for "sdk-50" is not available. Supported SDK versions: 57, 56.'
    );
  });

  it('prompts with only the SDK versions that have a published template', async () => {
    mockVersionsEndpoint({
      sdkVersions: {
        '57.0.0': { releaseNoteUrl: 'https://expo.dev/changelog/sdk-57' },
        '56.0.0': { releaseNoteUrl: 'https://expo.dev/changelog/sdk-56' },
        '55.0.0': { releaseNoteUrl: 'https://expo.dev/changelog/sdk-55' },
      },
    });
    jest.mocked(promptAsync).mockResolvedValueOnce({ answer: 56 });

    const template = await resolveTemplateAsync({});

    expect(template.npmTag).toBe('sdk-56');
    // SDK 55 has no dist-tag in the packument, so it must not be offered.
    expect(promptAsync).toHaveBeenCalledWith(
      expect.objectContaining({
        choices: [
          expect.objectContaining({ title: 'Latest (SDK 57)' }),
          expect.objectContaining({ title: 'Other SDK version…' }),
        ],
      })
    );
  });

  it('falls back to the latest tag when the versions endpoint is unavailable', async () => {
    jest.mocked(fetch).mockRejectedValueOnce(new Error('network error'));

    expect((await resolveTemplateAsync({})).npmTag).toBe('latest');
    expect(promptAsync).not.toHaveBeenCalled();
  });

  it('falls back to the latest tag when no listed version has a template', async () => {
    mockVersionsEndpoint({
      sdkVersions: { '99.0.0': { releaseNoteUrl: 'https://expo.dev/changelog/sdk-99' } },
    });

    expect((await resolveTemplateAsync({})).npmTag).toBe('latest');
    expect(promptAsync).not.toHaveBeenCalled();
  });
});
