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

    it('preserves entries with placeholder paths when imageAsset is null (broken state)', async () => {
      // Regression test for screenshots stuck in AWAITING_UPLOAD with no
      // rendered imageAsset. Pull used to drop these from config entirely,
      // which made it impossible to recover via push (since push only acts on
      // entries present in config). Now pull writes a placeholder path so the
      // user can drop in a replacement file or remove the entry to delete the
      // broken ASC record.
      const writer = jest.mocked(new AppleConfigWriter());

      const broken = new AppScreenshot(requestContext, 'SS_BROKEN', {
        fileName: '01.png',
        fileSize: 599307,
        imageAsset: null,
        assetDeliveryState: { state: 'AWAITING_UPLOAD', errors: [], warnings: [] },
      } as any);
      // getImageAssetUrl returns null when imageAsset is null.
      jest.spyOn(broken, 'getImageAssetUrl').mockReturnValue(null);

      const displayTypeMap = new Map<ScreenshotDisplayType, AppScreenshotSet>();
      const screenshotSet = new AppScreenshotSet(requestContext, 'SET_1', {
        screenshotDisplayType: ScreenshotDisplayType.APP_IPHONE_67,
        appScreenshots: [broken],
      } as any);
      displayTypeMap.set(ScreenshotDisplayType.APP_IPHONE_67, screenshotSet);

      const screenshotSets = new Map([['en-US', displayTypeMap]]);
      const locale = new AppStoreVersionLocalization(requestContext, 'LOC_1', {
        locale: 'en-US',
      } as any);

      await new ScreenshotsTask().downloadAsync({
        config: writer,
        context: {
          screenshotSets,
          versionLocales: [locale],
          projectDir: '/test/project',
        } as any,
      });

      // No fetch should have been attempted (URL was null).
      expect(mockFetch).not.toBeCalled();
      // Entry should still be present in config with the original filename.
      expect(writer.setScreenshots).toBeCalledWith('en-US', {
        [ScreenshotDisplayType.APP_IPHONE_67]: [
          'store/apple/screenshot/en-US/APP_IPHONE_67/01.png',
        ],
      });
    });

    it('uses index-based fallback filename when fileName is also null', async () => {
      const writer = jest.mocked(new AppleConfigWriter());

      const broken = new AppScreenshot(requestContext, 'SS_BROKEN', {
        fileName: null,
        fileSize: 0,
        imageAsset: null,
        assetDeliveryState: { state: 'AWAITING_UPLOAD', errors: [], warnings: [] },
      } as any);
      jest.spyOn(broken, 'getImageAssetUrl').mockReturnValue(null);

      const displayTypeMap = new Map<ScreenshotDisplayType, AppScreenshotSet>();
      displayTypeMap.set(
        ScreenshotDisplayType.APP_IPAD_PRO_3GEN_129,
        new AppScreenshotSet(requestContext, 'SET_2', {
          screenshotDisplayType: ScreenshotDisplayType.APP_IPAD_PRO_3GEN_129,
          appScreenshots: [broken],
        } as any)
      );

      const locale = new AppStoreVersionLocalization(requestContext, 'LOC_1', {
        locale: 'en-US',
      } as any);

      await new ScreenshotsTask().downloadAsync({
        config: writer,
        context: {
          screenshotSets: new Map([['en-US', displayTypeMap]]),
          versionLocales: [locale],
          projectDir: '/test/project',
        } as any,
      });

      expect(writer.setScreenshots).toBeCalledWith('en-US', {
        [ScreenshotDisplayType.APP_IPAD_PRO_3GEN_129]: [
          'store/apple/screenshot/en-US/APP_IPAD_PRO_3GEN_129/01.png',
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

    // Regression test for https://github.com/expo/eas-cli/issues/3690.
    //
    // The App Store Connect API does NOT return `relationships.appScreenshots`
    // on `GET /v1/appScreenshotSets/{id}` unless `?include=appScreenshots` is
    // passed, and `@expo/apple-utils` <= 2.1.21 does not pass it from
    // `AppScreenshotSet.infoAsync`. Without an explicit `query.includes` here
    // we would refresh the set with `attributes.appScreenshots === undefined`,
    // build an empty `screenshotsByFilename` map, end up with an empty
    // `orderedIds`, and silently skip `reorderScreenshotsAsync` — leaving the
    // live store with a stale order even though every (filename, fileSize)
    // pair already matched the local config and no upload was needed.
    it('passes `includes: ["appScreenshots"]` to `AppScreenshotSet.infoAsync` and reorders when the live order differs (#3690)', async () => {
      const existing1 = new AppScreenshot(requestContext, 'SS_1', {
        fileName: '01-home.png',
        fileSize: 1024,
        assetDeliveryState: { state: 'COMPLETE', errors: [], warnings: [] },
      } as any);
      const existing2 = new AppScreenshot(requestContext, 'SS_2', {
        fileName: '02-detail.png',
        fileSize: 1024,
        assetDeliveryState: { state: 'COMPLETE', errors: [], warnings: [] },
      } as any);

      const config = new AppleConfigReader({
        info: {
          'en-US': {
            title: 'My App',
            screenshots: {
              // Local config wants 01-home, 02-detail in that order.
              APP_IPHONE_67: ['./screenshots/01-home.png', './screenshots/02-detail.png'],
            },
          },
        },
      });

      const locale = new AppStoreVersionLocalization(requestContext, 'LOC_1', {
        locale: 'en-US',
      } as any);

      // The set already has both screenshots (so nothing is uploaded), but the
      // live order on App Store Connect is reversed.
      const screenshotSet = new AppScreenshotSet(requestContext, 'SET_1', {
        screenshotDisplayType: ScreenshotDisplayType.APP_IPHONE_67,
        appScreenshots: [existing2, existing1],
      } as any);

      const displayTypeMap = new Map<ScreenshotDisplayType, AppScreenshotSet>();
      displayTypeMap.set(ScreenshotDisplayType.APP_IPHONE_67, screenshotSet);
      const screenshotSets = new Map([['en-US', displayTypeMap]]);

      const infoSpy = jest.spyOn(AppScreenshotSet, 'infoAsync').mockResolvedValue(
        new AppScreenshotSet(requestContext, 'SET_1', {
          screenshotDisplayType: ScreenshotDisplayType.APP_IPHONE_67,
          // Refresh returns the stale (reversed) live order.
          appScreenshots: [existing2, existing1],
        } as any)
      );
      const reorderMock = jest.fn().mockResolvedValue([]);
      AppScreenshotSet.prototype.reorderScreenshotsAsync = reorderMock;

      await new ScreenshotsTask().uploadAsync({
        config,
        context: {
          screenshotSets,
          versionLocales: [locale],
          projectDir: '/test/project',
        } as any,
      });

      // The infoAsync call MUST request the appScreenshots relationship,
      // otherwise ASC returns no data and the reorder check is a no-op.
      expect(infoSpy).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({
          id: 'SET_1',
          query: expect.objectContaining({ includes: ['appScreenshots'] }),
        })
      );
      // Live order was [SS_2, SS_1]; config wants [SS_1, SS_2]. Reorder must run.
      expect(reorderMock).toHaveBeenCalledWith({ appScreenshots: ['SS_1', 'SS_2'] });
    });
  });
});
