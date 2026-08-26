import { detectProjectSdkVersionAsync } from '../../project/detectProjectSdkVersionAsync';
import { resolveExpoGoSdkVersionAsync } from '../expoGo';

jest.mock('../../project/detectProjectSdkVersionAsync');

const projectDir = '/test/project';
const mockDetectProjectSdkVersionAsync = jest.mocked(detectProjectSdkVersionAsync);

describe(resolveExpoGoSdkVersionAsync, () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockDetectProjectSdkVersionAsync.mockResolvedValue('55.0.0');
  });

  it('normalizes the detected project SDK version', async () => {
    await expect(resolveExpoGoSdkVersionAsync({ projectDir })).resolves.toBe('55.0.0');
    expect(mockDetectProjectSdkVersionAsync).toHaveBeenCalledWith(projectDir);
  });

  it.each([
    ['57', '57.0.0'],
    ['57.0.0', '57.0.0'],
    ['57.0.9', '57.0.0'],
  ])('normalizes an explicit SDK version (%s)', async (sdkVersion, expectedSdkVersion) => {
    await expect(resolveExpoGoSdkVersionAsync({ projectDir, sdkVersion })).resolves.toBe(
      expectedSdkVersion
    );
    expect(mockDetectProjectSdkVersionAsync).not.toHaveBeenCalled();
  });

  it('rejects an invalid explicit SDK version', async () => {
    await expect(
      resolveExpoGoSdkVersionAsync({ projectDir, sdkVersion: 'not-a-version' })
    ).rejects.toThrow(
      'Unable to parse Expo SDK version "not-a-version". Pass a major or semantic version, such as --sdk-version 57.'
    );
    expect(mockDetectProjectSdkVersionAsync).not.toHaveBeenCalled();
  });

  it.each([undefined, 'UNVERSIONED'])(
    'rejects an undetectable SDK version (%s)',
    async sdkVersion => {
      mockDetectProjectSdkVersionAsync.mockResolvedValue(sdkVersion);

      await expect(resolveExpoGoSdkVersionAsync({ projectDir })).rejects.toThrow(
        "Unable to determine this project's Expo SDK version, so Expo Go could not be selected."
      );
    }
  );
});
