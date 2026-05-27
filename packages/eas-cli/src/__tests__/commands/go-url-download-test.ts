import GoDownload from '../../commands/go/download';
import GoUrl from '../../commands/go/url';
import Log from '../../log';
import {
  copyExpoGoToPathAsync,
  downloadExpoGoAsync,
  getExpoGoDownloadUrlAsync,
} from '../../utils/expoGo';
import { getMockOclifConfig } from './utils';

jest.mock('../../log', () => ({
  __esModule: true,
  default: {
    log: jest.fn(),
  },
}));
jest.mock('../../utils/expoGo', () => ({
  ...jest.requireActual('../../utils/expoGo'),
  copyExpoGoToPathAsync: jest.fn(),
  downloadExpoGoAsync: jest.fn(),
  getExpoGoDownloadUrlAsync: jest.fn(),
}));

const mockGetExpoGoDownloadUrlAsync = jest.mocked(getExpoGoDownloadUrlAsync);
const mockDownloadExpoGoAsync = jest.mocked(downloadExpoGoAsync);
const mockCopyExpoGoToPathAsync = jest.mocked(copyExpoGoToPathAsync);

describe('go:url', () => {
  beforeEach(() => {
    mockGetExpoGoDownloadUrlAsync.mockResolvedValue({
      sdkVersion: '55.0.0',
      url: 'https://example.com/Exponent-55.apk',
    });
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  it('prints the resolved Expo Go URL for the platform and SDK version', async () => {
    await new GoUrl(['android', '55'], getMockOclifConfig()).runAsync();

    expect(mockGetExpoGoDownloadUrlAsync).toHaveBeenCalledWith('android', {
      sdkVersion: '55',
    });
    expect(Log.log).toHaveBeenCalledWith('https://example.com/Exponent-55.apk');
  });
});

describe('go:download', () => {
  beforeEach(() => {
    mockDownloadExpoGoAsync.mockResolvedValue({
      path: '/cache/Exponent-55.apk',
      sdkVersion: '55.0.0',
      url: 'https://example.com/Exponent-55.apk',
    });
    mockCopyExpoGoToPathAsync.mockResolvedValue('/output/Exponent-55.apk');
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  it('downloads an explicit SDK version to an explicit output path', async () => {
    await new GoDownload(['android', '55', '/output'], getMockOclifConfig()).runAsync();

    expect(mockDownloadExpoGoAsync).toHaveBeenCalledWith('android', {
      sdkVersion: '55',
    });
    expect(mockCopyExpoGoToPathAsync).toHaveBeenCalledWith({
      destinationPath: '/output',
      platform: 'android',
      sourcePath: '/cache/Exponent-55.apk',
    });
    expect(Log.log).toHaveBeenCalledWith(expect.stringContaining('/output/Exponent-55.apk'));
  });

  it('downloads the latest Expo Go to an output path when "latest" is passed', async () => {
    await new GoDownload(['ios', 'latest', '/output'], getMockOclifConfig()).runAsync();

    expect(mockDownloadExpoGoAsync).toHaveBeenCalledWith('ios', {
      sdkVersion: 'latest',
    });
    expect(mockCopyExpoGoToPathAsync).toHaveBeenCalledWith({
      destinationPath: '/output',
      platform: 'ios',
      sourcePath: '/cache/Exponent-55.apk',
    });
  });

  it('rejects a second argument that is not an SDK version', async () => {
    await expect(
      new GoDownload(['ios', '/output'], getMockOclifConfig()).runAsync()
    ).rejects.toThrow('Expected "/output" to be an Expo SDK version or "latest"');
  });
});
