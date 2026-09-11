import {
  AppScreenshot,
  AppScreenshotSet,
  AppStoreVersionLocalization,
  ScreenshotDisplayType,
} from '@expo/apple-utils';
import nock from 'nock';
import path from 'path';

import { requestContext } from './fixtures/requestContext';
import Log from '../../../../log';
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

    it('keeps original file names when they do not collide', async () => {
      const writer = jest.mocked(new AppleConfigWriter());
      const writeFile = jest.mocked(fs.promises.writeFile);

      const screenshots = ['home.png', 'settings.png'].map((fileName, index) => {
        const screenshot = new AppScreenshot(requestContext, `SS_${index}`, {
          fileName,
          fileSize: 1024,
          assetDeliveryState: { state: 'COMPLETE', errors: [], warnings: [] },
        } as any);
        jest
          .spyOn(screenshot, 'getImageAssetUrl')
          .mockReturnValue(`https://example.com/${fileName}`);
        return screenshot;
      });

      const displayTypeMap = new Map<ScreenshotDisplayType, AppScreenshotSet>();
      displayTypeMap.set(
        ScreenshotDisplayType.APP_IPHONE_67,
        new AppScreenshotSet(requestContext, 'SET_1', {
          screenshotDisplayType: ScreenshotDisplayType.APP_IPHONE_67,
          appScreenshots: screenshots,
        } as any)
      );

      const locale = new AppStoreVersionLocalization(requestContext, 'LOC_1', {
        locale: 'en-US',
      } as any);

      mockFetch.mockResolvedValue({
        ok: true,
        buffer: () => Promise.resolve(Buffer.from('fake-image-data')),
      });

      await new ScreenshotsTask().downloadAsync({
        config: writer,
        context: {
          screenshotSets: new Map([['en-US', displayTypeMap]]),
          versionLocales: [locale],
          projectDir: '/test/project',
        } as any,
      });

      // Without a collision, the file names from App Store Connect are used as-is.
      expect(writer.setScreenshots).toBeCalledWith('en-US', {
        [ScreenshotDisplayType.APP_IPHONE_67]: [
          'store/apple/screenshot/en-US/APP_IPHONE_67/home.png',
          'store/apple/screenshot/en-US/APP_IPHONE_67/settings.png',
        ],
      });
      expect(writeFile.mock.calls.map(call => call[0])).toEqual([
        '/test/project/store/apple/screenshot/en-US/APP_IPHONE_67/home.png',
        '/test/project/store/apple/screenshot/en-US/APP_IPHONE_67/settings.png',
      ]);
    });

    it('writes distinct files when screenshots share a file name', async () => {
      // Regression test for screenshots that report the same `fileName` within
      // a single set. Both used to resolve to the same local path, so the
      // second download overwrote the first and config listed the same path
      // twice - silently losing a screenshot on every pull.
      const writer = jest.mocked(new AppleConfigWriter());
      const writeFile = jest.mocked(fs.promises.writeFile);
      const warn = jest.spyOn(Log, 'warn').mockImplementation(() => {});

      const screenshots = ['SS_1', 'SS_2', 'SS_3'].map(id => {
        const screenshot = new AppScreenshot(requestContext, id, {
          fileName: 'iPhone 5.5 - 2.png',
          fileSize: 1024,
          assetDeliveryState: { state: 'COMPLETE', errors: [], warnings: [] },
        } as any);
        jest.spyOn(screenshot, 'getImageAssetUrl').mockReturnValue(`https://example.com/${id}.png`);
        return screenshot;
      });

      const displayTypeMap = new Map<ScreenshotDisplayType, AppScreenshotSet>();
      displayTypeMap.set(
        ScreenshotDisplayType.APP_IPHONE_55,
        new AppScreenshotSet(requestContext, 'SET_1', {
          screenshotDisplayType: ScreenshotDisplayType.APP_IPHONE_55,
          appScreenshots: screenshots,
        } as any)
      );

      const locale = new AppStoreVersionLocalization(requestContext, 'LOC_1', {
        locale: 'en-US',
      } as any);

      mockFetch.mockResolvedValue({
        ok: true,
        buffer: () => Promise.resolve(Buffer.from('fake-image-data')),
      });

      await new ScreenshotsTask().downloadAsync({
        config: writer,
        context: {
          screenshotSets: new Map([['en-US', displayTypeMap]]),
          versionLocales: [locale],
          projectDir: '/test/project',
        } as any,
      });

      expect(writer.setScreenshots).toBeCalledWith('en-US', {
        [ScreenshotDisplayType.APP_IPHONE_55]: [
          'store/apple/screenshot/en-US/APP_IPHONE_55/iPhone 5.5 - 2.png',
          'store/apple/screenshot/en-US/APP_IPHONE_55/iPhone 5.5 - 2-2.png',
          'store/apple/screenshot/en-US/APP_IPHONE_55/iPhone 5.5 - 2-3.png',
        ],
      });

      const configPaths = jest.mocked(writer.setScreenshots).mock.calls[0][1][
        ScreenshotDisplayType.APP_IPHONE_55
      ]!;
      expect(new Set(configPaths).size).toBe(configPaths.length);

      const writtenPaths = writeFile.mock.calls.map(call => call[0]);
      expect(writtenPaths).toEqual([
        '/test/project/store/apple/screenshot/en-US/APP_IPHONE_55/iPhone 5.5 - 2.png',
        '/test/project/store/apple/screenshot/en-US/APP_IPHONE_55/iPhone 5.5 - 2-2.png',
        '/test/project/store/apple/screenshot/en-US/APP_IPHONE_55/iPhone 5.5 - 2-3.png',
      ]);
      expect(new Set(writtenPaths).size).toBe(writtenPaths.length);

      // The rename is surfaced, so users can tell why the local file names
      // don't match what App Store Connect reports.
      expect(warn).toBeCalledTimes(2);
      expect(warn.mock.calls.map(call => call[0])).toEqual([
        expect.stringContaining(
          'are named iPhone 5.5 - 2.png, storing this one as iPhone 5.5 - 2-2.png'
        ),
        expect.stringContaining(
          'are named iPhone 5.5 - 2.png, storing this one as iPhone 5.5 - 2-3.png'
        ),
      ]);
      warn.mockRestore();
    });

    it('does not add suffixes for the same file name in different sets', async () => {
      const writer = jest.mocked(new AppleConfigWriter());

      const displayTypeMap = new Map<ScreenshotDisplayType, AppScreenshotSet>();
      for (const [setId, displayType] of [
        ['SET_1', ScreenshotDisplayType.APP_IPHONE_67],
        ['SET_2', ScreenshotDisplayType.APP_IPAD_PRO_3GEN_129],
      ] as const) {
        const screenshot = new AppScreenshot(requestContext, `SS_${setId}`, {
          fileName: 'home.png',
          fileSize: 1024,
          assetDeliveryState: { state: 'COMPLETE', errors: [], warnings: [] },
        } as any);
        jest.spyOn(screenshot, 'getImageAssetUrl').mockReturnValue('https://example.com/home.png');
        displayTypeMap.set(
          displayType,
          new AppScreenshotSet(requestContext, setId, {
            screenshotDisplayType: displayType,
            appScreenshots: [screenshot],
          } as any)
        );
      }

      const locale = new AppStoreVersionLocalization(requestContext, 'LOC_1', {
        locale: 'en-US',
      } as any);

      mockFetch.mockResolvedValue({
        ok: true,
        buffer: () => Promise.resolve(Buffer.from('fake-image-data')),
      });

      await new ScreenshotsTask().downloadAsync({
        config: writer,
        context: {
          screenshotSets: new Map([['en-US', displayTypeMap]]),
          versionLocales: [locale],
          projectDir: '/test/project',
        } as any,
      });

      // Each set has its own directory, so there is no collision to resolve.
      expect(writer.setScreenshots).toBeCalledWith('en-US', {
        [ScreenshotDisplayType.APP_IPHONE_67]: [
          'store/apple/screenshot/en-US/APP_IPHONE_67/home.png',
        ],
        [ScreenshotDisplayType.APP_IPAD_PRO_3GEN_129]: [
          'store/apple/screenshot/en-US/APP_IPAD_PRO_3GEN_129/home.png',
        ],
      });
    });

    it('deduplicates placeholder paths when broken screenshots share a file name', async () => {
      const writer = jest.mocked(new AppleConfigWriter());

      const screenshots = ['SS_1', 'SS_2'].map(id => {
        const screenshot = new AppScreenshot(requestContext, id, {
          fileName: '01.png',
          fileSize: 599307,
          imageAsset: null,
          assetDeliveryState: { state: 'AWAITING_UPLOAD', errors: [], warnings: [] },
        } as any);
        jest.spyOn(screenshot, 'getImageAssetUrl').mockReturnValue(null);
        return screenshot;
      });

      const displayTypeMap = new Map<ScreenshotDisplayType, AppScreenshotSet>();
      displayTypeMap.set(
        ScreenshotDisplayType.APP_IPHONE_67,
        new AppScreenshotSet(requestContext, 'SET_1', {
          screenshotDisplayType: ScreenshotDisplayType.APP_IPHONE_67,
          appScreenshots: screenshots,
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
        [ScreenshotDisplayType.APP_IPHONE_67]: [
          'store/apple/screenshot/en-US/APP_IPHONE_67/01.png',
          'store/apple/screenshot/en-US/APP_IPHONE_67/01-2.png',
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
  });

  describe('downloadAsync -> uploadAsync', () => {
    /** Run a pull, then push back the config it produced, against the same remote set. */
    async function runRoundTripAsync(fileNames: string[]): Promise<{
      configPaths: string[];
      uploadedPaths: string[];
      deletedIds: string[];
    }> {
      const remoteScreenshots = fileNames.map((fileName, index) => {
        const screenshot = new AppScreenshot(requestContext, `SS_${index}`, {
          fileName,
          fileSize: 1024,
          assetDeliveryState: { state: 'COMPLETE', errors: [], warnings: [] },
        } as any);
        jest
          .spyOn(screenshot, 'getImageAssetUrl')
          .mockReturnValue(`https://example.com/${index}.png`);
        return screenshot;
      });

      const displayTypeMap = new Map<ScreenshotDisplayType, AppScreenshotSet>();
      const remoteSet = new AppScreenshotSet(requestContext, 'SET_1', {
        screenshotDisplayType: ScreenshotDisplayType.APP_IPHONE_67,
        appScreenshots: remoteScreenshots,
      } as any);
      displayTypeMap.set(ScreenshotDisplayType.APP_IPHONE_67, remoteSet);

      const locale = new AppStoreVersionLocalization(requestContext, 'LOC_1', {
        locale: 'en-US',
      } as any);

      mockFetch.mockResolvedValue({
        ok: true,
        buffer: () => Promise.resolve(Buffer.from('fake-image-data')),
      });

      const writer = jest.mocked(new AppleConfigWriter());
      await new ScreenshotsTask().downloadAsync({
        config: writer,
        context: {
          screenshotSets: new Map([['en-US', displayTypeMap]]),
          versionLocales: [locale],
          projectDir: '/test/project',
        } as any,
      });

      const configPaths = jest.mocked(writer.setScreenshots).mock.calls[0][1][
        ScreenshotDisplayType.APP_IPHONE_67
      ]!;

      const deletedIds: string[] = [];
      for (const screenshot of remoteScreenshots) {
        jest.spyOn(screenshot, 'deleteAsync').mockImplementation(async () => {
          deletedIds.push(screenshot.id);
          return undefined as any;
        });
      }
      jest.spyOn(AppScreenshot, 'uploadAsync').mockImplementation(
        async (_context: any, { filePath }: any) =>
          new AppScreenshot(requestContext, `UPLOADED_${filePath}`, {
            fileName: path.basename(filePath),
            fileSize: 1024,
            assetDeliveryState: { state: 'COMPLETE', errors: [], warnings: [] },
          } as any)
      );
      jest.spyOn(AppScreenshotSet, 'infoAsync').mockResolvedValue(remoteSet);
      AppScreenshotSet.prototype.reorderScreenshotsAsync = jest.fn().mockResolvedValue([]);

      await new ScreenshotsTask().uploadAsync({
        config: new AppleConfigReader({
          info: {
            'en-US': {
              screenshots: { [ScreenshotDisplayType.APP_IPHONE_67]: configPaths },
            },
          },
        } as any),
        context: {
          screenshotSets: new Map([['en-US', displayTypeMap]]),
          versionLocales: [locale],
          projectDir: '/test/project',
        } as any,
      });

      return {
        configPaths,
        uploadedPaths: jest
          .mocked(AppScreenshot.uploadAsync)
          .mock.calls.map(call => (call[1] as any).filePath),
        deletedIds,
      };
    }

    it('pushes back a pulled config without re-uploading or deleting anything', async () => {
      const { configPaths, uploadedPaths, deletedIds } = await runRoundTripAsync([
        'home.png',
        'settings.png',
      ]);

      expect(configPaths).toEqual([
        'store/apple/screenshot/en-US/APP_IPHONE_67/home.png',
        'store/apple/screenshot/en-US/APP_IPHONE_67/settings.png',
      ]);
      // Every local file name still matches its remote counterpart, so push is a no-op.
      expect(uploadedPaths).toEqual([]);
      expect(deletedIds).toEqual([]);
    });

    it('only re-uploads the renamed duplicate when file names collide remotely', async () => {
      const { configPaths, uploadedPaths, deletedIds } = await runRoundTripAsync([
        'home.png',
        'home.png',
      ]);

      expect(configPaths).toEqual([
        'store/apple/screenshot/en-US/APP_IPHONE_67/home.png',
        'store/apple/screenshot/en-US/APP_IPHONE_67/home-2.png',
      ]);
      // App Store Connect allows several screenshots with the same file name,
      // but the local file system does not, so the duplicate cannot keep the
      // remote name and has to be re-uploaded under the suffixed one. The entry
      // that kept the original name still matches its remote counterpart and is
      // left untouched, and nothing is deleted.
      // Push matching is keyed on the file name (see `syncScreenshotSetAsync`),
      // so it can't tell two identically named remote screenshots apart. That
      // limitation is unchanged here - the point is that the local files are no
      // longer collapsed into one during pull.
      expect(uploadedPaths).toEqual([
        '/test/project/store/apple/screenshot/en-US/APP_IPHONE_67/home-2.png',
      ]);
      expect(deletedIds).toEqual([]);
    });
  });
});
