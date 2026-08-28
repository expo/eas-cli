import fetch from '../../../fetch';
import { promptAsync } from '../../../prompts';
import {
  fetchSdkVersionsAsync,
  promptForSdkVersionAsync,
  resolveTemplateSdkTagAsync,
} from '../sdkVersion';

jest.mock('../../../fetch');
jest.mock('../../../prompts');
jest.mock('../../../api', () => ({
  getExpoApiBaseUrl: () => 'https://api.expo.dev',
}));

function mockVersionsEndpoint(json: object): void {
  jest.mocked(fetch).mockResolvedValueOnce({ json: async () => json } as any);
}

describe('fetchSdkVersionsAsync', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

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
  beforeEach(() => {
    jest.clearAllMocks();
  });

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

  it('hides the Expo Go choice when it matches the latest SDK', async () => {
    jest.mocked(promptAsync).mockResolvedValueOnce({ answer: 57 });

    await promptForSdkVersionAsync({ latest: 57, expoGoCompatible: 57, available: [57, 56] });

    expect(promptAsync).toHaveBeenCalledWith(
      expect.objectContaining({
        choices: [
          expect.objectContaining({ title: 'Latest (SDK 57)' }),
          expect.objectContaining({ title: 'Other SDK version…' }),
        ],
      })
    );
  });

  it('prompts for a specific version when "other" is selected', async () => {
    jest
      .mocked(promptAsync)
      .mockResolvedValueOnce({ answer: 'other' })
      .mockResolvedValueOnce({ sdkVersion: 54 });

    const result = await promptForSdkVersionAsync({
      latest: 57,
      expoGoCompatible: null,
      available: [57, 56, 55, 54, 53],
    });

    expect(result).toBe(54);
    expect(promptAsync).toHaveBeenLastCalledWith(
      expect.objectContaining({
        message: 'Select an SDK version:',
        choices: [
          { title: 'SDK 57', value: 57 },
          { title: 'SDK 56', value: 56 },
          { title: 'SDK 55', value: 55 },
          { title: 'SDK 54', value: 54 },
        ],
      })
    );
  });
});

describe('resolveTemplateSdkTagAsync', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('uses the provided SDK version without prompting', async () => {
    expect(await resolveTemplateSdkTagAsync({ sdkVersion: '56' })).toBe('sdk-56');
    expect(await resolveTemplateSdkTagAsync({ sdkVersion: 'sdk-55' })).toBe('sdk-55');
    expect(promptAsync).not.toHaveBeenCalled();
    expect(fetch).not.toHaveBeenCalled();
  });

  it('throws for an invalid SDK version', async () => {
    await expect(resolveTemplateSdkTagAsync({ sdkVersion: 'abc' })).rejects.toThrow(
      'Invalid SDK version'
    );
  });

  it('prompts for the SDK version when none is provided', async () => {
    mockVersionsEndpoint({
      sdkVersions: { '57.0.0': { releaseNoteUrl: 'https://expo.dev/changelog/sdk-57' } },
    });
    jest.mocked(promptAsync).mockResolvedValueOnce({ answer: 57 });

    expect(await resolveTemplateSdkTagAsync({})).toBe('sdk-57');
  });

  it('falls back to the latest tag when the versions endpoint is unavailable', async () => {
    jest.mocked(fetch).mockRejectedValueOnce(new Error('network error'));

    expect(await resolveTemplateSdkTagAsync({})).toBe('latest');
    expect(promptAsync).not.toHaveBeenCalled();
  });
});
