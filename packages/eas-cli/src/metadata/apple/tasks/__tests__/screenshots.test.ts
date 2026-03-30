import {
  AppScreenshot,
  AppScreenshotSet,
  AppStoreVersionLocalization,
  ScreenshotDisplayType,
} from '@expo/apple-utils';
import nock from 'nock';

import { requestContext } from './fixtures/requestContext';
import { AppleConfigReader } from '../../config/reader';
import { AppleConfigWriter } from '../../config/writer';
import { PartialAppleData } from '../../data';
import { ScreenshotsTask } from '../screenshots';

jest.mock('../../../../ora');
jest.mock('../../config/writer');

const mockFetch = jest.fn();
jest.mock('../../../../fetch', () => ({
  __esModule: true,
  default: (...args: any[]) => mockFetch(...args),
}));

import fs from 'fs';

jest.spyOn(fs, 'existsSync').mockReturnValue(true);
jest.spyOn(fs, 'statSync').mockReturnValue({ size: 1024 } as any);
jest.spyOn(fs.promises, 'mkdir').mockResolvedValue(undefined);
jest.spyOn(fs.promises, 'writeFile').mockResolvedValue(undefined);

describe(ScreenshotsTask, () => {
  beforeEach(() => {
    nock.cleanAll();
    jest.clearAllMocks();
  });

  describe('prepareAsync', () => {
    it('initializes empty screenshot sets when no locales are available', async () => {
      const context: PartialAppleData = {
        app: {} as any,
        projectDir: '/test/project',
        versionLocales: undefined,
      };

      await new ScreenshotsTask().prepareAsync({ context });

      expect(context.screenshotSets).toBeDefined();
      expect(context.screenshotSets!.size).toBe(0);
    });

    it('fetches screenshot sets for each locale', async () => {
      const locale = new AppStoreVersionLocalization(requestContext, 'LOC_1', {
        locale: 'en-US',
      } as any);

      const scope = nock('https://api.appstoreconnect.apple.com')
        .get(`/v1/${AppStoreVersionLocalization.type}/LOC_1/${AppScreenshotSet.type}`)
        .query(true)
        .reply(200, {
          data: [
            {
              id: 'SET_1',
              type: AppScreenshotSet.type,
              attributes: {
                screenshotDisplayType: ScreenshotDisplayType.APP_IPHONE_67,
                appScreenshots: [],
              },
            },
          ],
        });

      const context: PartialAppleData = {
        app: {} as any,
        projectDir: '/test/project',
        versionLocales: [locale],
      };

      await new ScreenshotsTask().prepareAsync({ context });

      expect(context.screenshotSets).toBeDefined();
      expect(context.screenshotSets!.size).toBe(1);
      expect(context.screenshotSets!.get('en-US')).toBeDefined();
      expect(
        context.screenshotSets!.get('en-US')!.has(ScreenshotDisplayType.APP_IPHONE_67)
      ).toBeTruthy();
      expect(scope.isDone()).toBeTruthy();
    });
  });

  describe('downloadAsync', () => {
    it('skips when screenshot sets are not prepared', async () => {
      const writer = jest.mocked(new AppleConfigWriter());

      await new ScreenshotsTask().downloadAsync({
        config: writer,
        context: { screenshotSets: undefined, versionLocales: undefined } as any,
      });

      expect(writer.setScreenshots).not.toBeCalled();
    });

    it('skips locales with no screenshot sets', async () => {
      const writer = jest.mocked(new AppleConfigWriter());
      const screenshotSets = new Map();
      screenshotSets.set('en-US', new Map());

      const locale = new AppStoreVersionLocalization(requestContext, 'LOC_1', {
        locale: 'en-US',
      } as any);

      await new ScreenshotsTask().downloadAsync({
        config: writer,
        context: {
          screenshotSets,
          versionLocales: [locale],
        } as any,
      });

      expect(writer.setScreenshots).not.toBeCalled();
    });

    it('downloads screenshots and sets config', async () => {
      const writer = jest.mocked(new AppleConfigWriter());

      const screenshot = new AppScreenshot(requestContext, 'SS_1', {
        fileName: 'home.png',
        fileSize: 1024,
        assetDeliveryState: {
          state: 'COMPLETE',
          errors: [],
          warnings: [],
        },
      } as any);

      // Mock getImageAssetUrl
      jest.spyOn(screenshot, 'getImageAssetUrl').mockReturnValue('https://example.com/home.png');

      const displayTypeMap = new Map<ScreenshotDisplayType, AppScreenshotSet>();
      const screenshotSet = new AppScreenshotSet(requestContext, 'SET_1', {
        screenshotDisplayType: ScreenshotDisplayType.APP_IPHONE_67,
        appScreenshots: [screenshot],
      } as any);
      displayTypeMap.set(ScreenshotDisplayType.APP_IPHONE_67, screenshotSet);

      const screenshotSets = new Map();
      screenshotSets.set('en-US', displayTypeMap);

      const locale = new AppStoreVersionLocalization(requestContext, 'LOC_1', {
        locale: 'en-US',
      } as any);

      // Mock fetch response
      mockFetch.mockResolvedValue({
        ok: true,
        buffer: () => Promise.resolve(Buffer.from('fake-image-data')),
      });

      await new ScreenshotsTask().downloadAsync({
        config: writer,
        context: {
          screenshotSets,
          versionLocales: [locale],
          projectDir: '/test/project',
        } as any,
      });

      expect(writer.setScreenshots).toBeCalledWith('en-US', {
        [ScreenshotDisplayType.APP_IPHONE_67]: [
          'store/apple/screenshot/en-US/APP_IPHONE_67/home.png',
        ],
      });
    });
  });

  describe('uploadAsync', () => {
    it('skips when screenshot sets are not prepared', async () => {
      const config = new AppleConfigReader({});

      await new ScreenshotsTask().uploadAsync({
        config,
        context: { screenshotSets: undefined, versionLocales: undefined } as any,
      });

      // Should not throw, just log and return
    });

    it('skips when no locales are configured', async () => {
      const config = new AppleConfigReader({});

      await new ScreenshotsTask().uploadAsync({
        config,
        context: {
          screenshotSets: new Map(),
          versionLocales: [],
        } as any,
      });

      // Should not throw, just log and return
    });

    it('skips locales without screenshots in config', async () => {
      const config = new AppleConfigReader({
        info: {
          'en-US': {
            title: 'My App',
            // No screenshots
          },
        },
      });

      const locale = new AppStoreVersionLocalization(requestContext, 'LOC_1', {
        locale: 'en-US',
      } as any);

      await new ScreenshotsTask().uploadAsync({
        config,
        context: {
          screenshotSets: new Map(),
          versionLocales: [locale],
        } as any,
      });

      // Should complete without uploading
    });

    it('uploads new screenshots for configured locale', async () => {
      const config = new AppleConfigReader({
        info: {
          'en-US': {
            title: 'My App',
            screenshots: {
              APP_IPHONE_67: ['./screenshots/home.png'],
            },
          },
        },
      });

      const locale = new AppStoreVersionLocalization(requestContext, 'LOC_1', {
        locale: 'en-US',
      } as any);

      const newScreenshot = new AppScreenshot(requestContext, 'NEW_SS_1', {
        fileName: 'home.png',
        fileSize: 1024,
        assetDeliveryState: { state: 'COMPLETE', errors: [], warnings: [] },
      } as any);

      // Mock createAppScreenshotSetAsync on the locale
      const scope = nock('https://api.appstoreconnect.apple.com')
        // Create screenshot set
        .post(`/v1/${AppScreenshotSet.type}`)
        .reply(201, {
          data: {
            id: 'NEW_SET_1',
            type: AppScreenshotSet.type,
            attributes: {
              screenshotDisplayType: ScreenshotDisplayType.APP_IPHONE_67,
              appScreenshots: [],
            },
          },
        });

      // Mock AppScreenshot.uploadAsync to avoid real file access
      jest.spyOn(AppScreenshot, 'uploadAsync').mockResolvedValue(newScreenshot);

      // Mock AppScreenshotSet.infoAsync for reorder step
      jest.spyOn(AppScreenshotSet, 'infoAsync').mockResolvedValue(
        new AppScreenshotSet(requestContext, 'NEW_SET_1', {
          screenshotDisplayType: ScreenshotDisplayType.APP_IPHONE_67,
          appScreenshots: [newScreenshot],
        } as any)
      );

      // Mock reorderScreenshotsAsync
      const reorderMock = jest.fn().mockResolvedValue([]);
      AppScreenshotSet.prototype.reorderScreenshotsAsync = reorderMock;

      const screenshotSets = new Map();
      screenshotSets.set('en-US', new Map());

      await new ScreenshotsTask().uploadAsync({
        config,
        context: {
          screenshotSets,
          versionLocales: [locale],
          projectDir: '/test/project',
        } as any,
      });

      expect(scope.isDone()).toBeTruthy();
      expect(AppScreenshot.uploadAsync).toHaveBeenCalledWith(
        requestContext,
        expect.objectContaining({
          id: 'NEW_SET_1',
          filePath: '/test/project/screenshots/home.png',
          waitForProcessing: true,
        })
      );
      // Reorder is skipped because the current order already matches
      expect(reorderMock).not.toHaveBeenCalled();
    });
  });
});
