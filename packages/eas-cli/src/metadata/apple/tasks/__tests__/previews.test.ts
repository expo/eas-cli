import {
  AppPreview,
  AppPreviewSet,
  AppStoreVersionLocalization,
  PreviewType,
} from '@expo/apple-utils';
import nock from 'nock';

import { requestContext } from './fixtures/requestContext';
import { AppleConfigReader } from '../../config/reader';
import { AppleConfigWriter } from '../../config/writer';
import { PartialAppleData } from '../../data';
import { PreviewsTask } from '../previews';

jest.mock('../../../../ora');
jest.mock('../../config/writer');

const mockFetch = jest.fn();
jest.mock('../../../../fetch', () => ({
  __esModule: true,
  default: (...args: any[]) => mockFetch(...args),
}));

import fs from 'fs';

jest.spyOn(fs, 'existsSync').mockReturnValue(true);
jest.spyOn(fs, 'statSync').mockReturnValue({ size: 10240 } as any);
jest.spyOn(fs.promises, 'mkdir').mockResolvedValue(undefined);
jest.spyOn(fs.promises, 'writeFile').mockResolvedValue(undefined);

describe(PreviewsTask, () => {
  beforeEach(() => {
    nock.cleanAll();
    jest.clearAllMocks();
  });

  describe('prepareAsync', () => {
    it('initializes empty preview sets when no locales are available', async () => {
      const context: PartialAppleData = {
        app: {} as any,
        projectDir: '/test/project',
        versionLocales: undefined,
      };

      await new PreviewsTask().prepareAsync({ context });

      expect(context.previewSets).toBeDefined();
      expect(context.previewSets!.size).toBe(0);
    });

    it('fetches preview sets for each locale', async () => {
      const locale = new AppStoreVersionLocalization(requestContext, 'LOC_1', {
        locale: 'en-US',
      } as any);

      const scope = nock('https://api.appstoreconnect.apple.com')
        .get(`/v1/${AppStoreVersionLocalization.type}/LOC_1/${AppPreviewSet.type}`)
        .query(true)
        .reply(200, {
          data: [
            {
              id: 'PSET_1',
              type: AppPreviewSet.type,
              attributes: {
                previewType: PreviewType.IPHONE_67,
                appPreviews: [],
              },
            },
          ],
        });

      const context: PartialAppleData = {
        app: {} as any,
        projectDir: '/test/project',
        versionLocales: [locale],
      };

      await new PreviewsTask().prepareAsync({ context });

      expect(context.previewSets).toBeDefined();
      expect(context.previewSets!.size).toBe(1);
      expect(context.previewSets!.get('en-US')).toBeDefined();
      expect(context.previewSets!.get('en-US')!.has(PreviewType.IPHONE_67)).toBeTruthy();
      expect(scope.isDone()).toBeTruthy();
    });
  });

  describe('downloadAsync', () => {
    it('skips when preview sets are not prepared', async () => {
      const writer = jest.mocked(new AppleConfigWriter());

      await new PreviewsTask().downloadAsync({
        config: writer,
        context: { previewSets: undefined, versionLocales: undefined } as any,
      });

      expect(writer.setPreviews).not.toBeCalled();
    });

    it('skips locales with no preview sets', async () => {
      const writer = jest.mocked(new AppleConfigWriter());
      const previewSets = new Map();
      previewSets.set('en-US', new Map());

      const locale = new AppStoreVersionLocalization(requestContext, 'LOC_1', {
        locale: 'en-US',
      } as any);

      await new PreviewsTask().downloadAsync({
        config: writer,
        context: {
          previewSets,
          versionLocales: [locale],
        } as any,
      });

      expect(writer.setPreviews).not.toBeCalled();
    });

    it('downloads previews and sets config with simple path', async () => {
      const writer = jest.mocked(new AppleConfigWriter());

      const preview = new AppPreview(requestContext, 'PV_1', {
        fileName: 'demo.mp4',
        fileSize: 10240,
        previewFrameTimeCode: null,
        videoUrl: 'https://example.com/demo.mp4',
        assetDeliveryState: {
          state: 'COMPLETE',
          errors: [],
          warnings: [],
        },
      } as any);

      jest.spyOn(preview, 'getVideoUrl').mockReturnValue('https://example.com/demo.mp4');

      const previewTypeMap = new Map<PreviewType, AppPreviewSet>();
      const previewSet = new AppPreviewSet(requestContext, 'PSET_1', {
        previewType: PreviewType.IPHONE_67,
        appPreviews: [preview],
      } as any);
      previewTypeMap.set(PreviewType.IPHONE_67, previewSet);

      const previewSets = new Map();
      previewSets.set('en-US', previewTypeMap);

      const locale = new AppStoreVersionLocalization(requestContext, 'LOC_1', {
        locale: 'en-US',
      } as any);

      mockFetch.mockResolvedValue({
        ok: true,
        buffer: () => Promise.resolve(Buffer.from('fake-video-data')),
      });

      await new PreviewsTask().downloadAsync({
        config: writer,
        context: {
          previewSets,
          versionLocales: [locale],
          projectDir: '/test/project',
        } as any,
      });

      expect(writer.setPreviews).toBeCalledWith('en-US', {
        [PreviewType.IPHONE_67]: 'store/apple/preview/en-US/IPHONE_67/demo.mp4',
      });
    });

    it('downloads previews with previewFrameTimeCode as object config', async () => {
      const writer = jest.mocked(new AppleConfigWriter());

      const preview = new AppPreview(requestContext, 'PV_1', {
        fileName: 'demo.mp4',
        fileSize: 10240,
        previewFrameTimeCode: '00:05:00',
        videoUrl: 'https://example.com/demo.mp4',
        assetDeliveryState: {
          state: 'COMPLETE',
          errors: [],
          warnings: [],
        },
      } as any);

      jest.spyOn(preview, 'getVideoUrl').mockReturnValue('https://example.com/demo.mp4');

      const previewTypeMap = new Map<PreviewType, AppPreviewSet>();
      const previewSet = new AppPreviewSet(requestContext, 'PSET_1', {
        previewType: PreviewType.IPHONE_67,
        appPreviews: [preview],
      } as any);
      previewTypeMap.set(PreviewType.IPHONE_67, previewSet);

      const previewSets = new Map();
      previewSets.set('en-US', previewTypeMap);

      const locale = new AppStoreVersionLocalization(requestContext, 'LOC_1', {
        locale: 'en-US',
      } as any);

      mockFetch.mockResolvedValue({
        ok: true,
        buffer: () => Promise.resolve(Buffer.from('fake-video-data')),
      });

      await new PreviewsTask().downloadAsync({
        config: writer,
        context: {
          previewSets,
          versionLocales: [locale],
          projectDir: '/test/project',
        } as any,
      });

      expect(writer.setPreviews).toBeCalledWith('en-US', {
        [PreviewType.IPHONE_67]: {
          path: 'store/apple/preview/en-US/IPHONE_67/demo.mp4',
          previewFrameTimeCode: '00:05:00',
        },
      });
    });

    it('preserves entries with placeholder paths when videoUrl is null (broken state)', async () => {
      // Same regression as for screenshots: previews stuck in AWAITING_UPLOAD
      // with no rendered videoUrl used to be dropped from config. Now we
      // preserve the entry so the user can recover.
      const writer = jest.mocked(new AppleConfigWriter());

      const broken = new AppPreview(requestContext, 'PV_BROKEN', {
        fileName: 'demo.mp4',
        fileSize: 12345,
        videoUrl: null,
        assetDeliveryState: { state: 'AWAITING_UPLOAD', errors: [], warnings: [] },
      } as any);
      jest.spyOn(broken, 'getVideoUrl').mockReturnValue(null);

      const previewTypeMap = new Map<PreviewType, AppPreviewSet>();
      previewTypeMap.set(
        PreviewType.IPHONE_67,
        new AppPreviewSet(requestContext, 'PSET_1', {
          previewType: PreviewType.IPHONE_67,
          appPreviews: [broken],
        } as any)
      );

      const locale = new AppStoreVersionLocalization(requestContext, 'LOC_1', {
        locale: 'en-US',
      } as any);

      await new PreviewsTask().downloadAsync({
        config: writer,
        context: {
          previewSets: new Map([['en-US', previewTypeMap]]),
          versionLocales: [locale],
          projectDir: '/test/project',
        } as any,
      });

      expect(mockFetch).not.toBeCalled();
      expect(writer.setPreviews).toBeCalledWith('en-US', {
        [PreviewType.IPHONE_67]: 'store/apple/preview/en-US/IPHONE_67/demo.mp4',
      });
    });
  });

  describe('uploadAsync', () => {
    it('skips when preview sets are not prepared', async () => {
      const config = new AppleConfigReader({});

      await new PreviewsTask().uploadAsync({
        config,
        context: { previewSets: undefined, versionLocales: undefined } as any,
      });

      // Should not throw, just log and return
    });

    it('skips when no locales are configured', async () => {
      const config = new AppleConfigReader({});

      await new PreviewsTask().uploadAsync({
        config,
        context: {
          previewSets: new Map(),
          versionLocales: [],
        } as any,
      });

      // Should not throw, just log and return
    });

    it('skips locales without previews in config', async () => {
      const config = new AppleConfigReader({
        info: {
          'en-US': {
            title: 'My App',
            // No previews
          },
        },
      });

      const locale = new AppStoreVersionLocalization(requestContext, 'LOC_1', {
        locale: 'en-US',
      } as any);

      await new PreviewsTask().uploadAsync({
        config,
        context: {
          previewSets: new Map(),
          versionLocales: [locale],
        } as any,
      });

      // Should complete without uploading
    });

    it('uploads new preview for configured locale with string path', async () => {
      const config = new AppleConfigReader({
        info: {
          'en-US': {
            title: 'My App',
            previews: {
              IPHONE_67: './previews/demo.mp4',
            },
          },
        },
      });

      const locale = new AppStoreVersionLocalization(requestContext, 'LOC_1', {
        locale: 'en-US',
      } as any);

      const newPreview = new AppPreview(requestContext, 'NEW_PV_1', {
        fileName: 'demo.mp4',
        fileSize: 10240,
        previewFrameTimeCode: null,
        assetDeliveryState: { state: 'COMPLETE', errors: [], warnings: [] },
      } as any);

      const scope = nock('https://api.appstoreconnect.apple.com')
        // Create preview set
        .post(`/v1/${AppPreviewSet.type}`)
        .reply(201, {
          data: {
            id: 'NEW_PSET_1',
            type: AppPreviewSet.type,
            attributes: {
              previewType: PreviewType.IPHONE_67,
              appPreviews: [],
            },
          },
        });

      // Mock AppPreview.uploadAsync to avoid real file access
      jest.spyOn(AppPreview, 'uploadAsync').mockResolvedValue(newPreview);

      // Mock AppPreviewSet.infoAsync for the reorder step
      jest.spyOn(AppPreviewSet, 'infoAsync').mockResolvedValue(
        new AppPreviewSet(requestContext, 'NEW_PSET_1', {
          previewType: PreviewType.IPHONE_67,
          appPreviews: [newPreview],
        } as any)
      );

      const reorderMock = jest.fn().mockResolvedValue([]);
      AppPreviewSet.prototype.reorderPreviewsAsync = reorderMock;

      const previewSets = new Map();
      previewSets.set('en-US', new Map());

      await new PreviewsTask().uploadAsync({
        config,
        context: {
          previewSets,
          versionLocales: [locale],
          projectDir: '/test/project',
        } as any,
      });

      expect(scope.isDone()).toBeTruthy();
      expect(AppPreview.uploadAsync).toHaveBeenCalledWith(
        requestContext,
        expect.objectContaining({
          id: 'NEW_PSET_1',
          filePath: '/test/project/previews/demo.mp4',
          waitForProcessing: true,
        })
      );
      // Single preview, current order matches: reorder should be skipped.
      expect(reorderMock).not.toHaveBeenCalled();
    });

    it('uploads multiple previews when configured as an array', async () => {
      const config = new AppleConfigReader({
        info: {
          'en-US': {
            title: 'My App',
            previews: {
              IPHONE_67: [
                './previews/intro.mp4',
                { path: './previews/features.mp4', previewFrameTimeCode: '00:02:00' },
                './previews/outro.mp4',
              ],
            },
          },
        },
      });

      const locale = new AppStoreVersionLocalization(requestContext, 'LOC_1', {
        locale: 'en-US',
      } as any);

      const intro = new AppPreview(requestContext, 'NEW_PV_INTRO', {
        fileName: 'intro.mp4',
        fileSize: 10240,
        previewFrameTimeCode: null,
        assetDeliveryState: { state: 'COMPLETE', errors: [], warnings: [] },
      } as any);
      const features = new AppPreview(requestContext, 'NEW_PV_FEATURES', {
        fileName: 'features.mp4',
        fileSize: 10240,
        previewFrameTimeCode: '00:02:00',
        assetDeliveryState: { state: 'COMPLETE', errors: [], warnings: [] },
      } as any);
      const outro = new AppPreview(requestContext, 'NEW_PV_OUTRO', {
        fileName: 'outro.mp4',
        fileSize: 10240,
        previewFrameTimeCode: null,
        assetDeliveryState: { state: 'COMPLETE', errors: [], warnings: [] },
      } as any);

      const scope = nock('https://api.appstoreconnect.apple.com')
        .post(`/v1/${AppPreviewSet.type}`)
        .reply(201, {
          data: {
            id: 'NEW_PSET_1',
            type: AppPreviewSet.type,
            attributes: {
              previewType: PreviewType.IPHONE_67,
              appPreviews: [],
            },
          },
        });

      const uploadSpy = jest
        .spyOn(AppPreview, 'uploadAsync')
        .mockResolvedValueOnce(intro)
        .mockResolvedValueOnce(features)
        .mockResolvedValueOnce(outro);

      // After upload Apple returns the previews in upload order, which already matches config.
      jest.spyOn(AppPreviewSet, 'infoAsync').mockResolvedValue(
        new AppPreviewSet(requestContext, 'NEW_PSET_1', {
          previewType: PreviewType.IPHONE_67,
          appPreviews: [intro, features, outro],
        } as any)
      );

      const reorderMock = jest.fn().mockResolvedValue([]);
      AppPreviewSet.prototype.reorderPreviewsAsync = reorderMock;

      const previewSets = new Map();
      previewSets.set('en-US', new Map());

      await new PreviewsTask().uploadAsync({
        config,
        context: {
          previewSets,
          versionLocales: [locale],
          projectDir: '/test/project',
        } as any,
      });

      expect(scope.isDone()).toBeTruthy();
      expect(uploadSpy).toHaveBeenCalledTimes(3);
      expect(uploadSpy).toHaveBeenNthCalledWith(
        1,
        requestContext,
        expect.objectContaining({ filePath: '/test/project/previews/intro.mp4' })
      );
      expect(uploadSpy).toHaveBeenNthCalledWith(
        2,
        requestContext,
        expect.objectContaining({
          filePath: '/test/project/previews/features.mp4',
          previewFrameTimeCode: '00:02:00',
        })
      );
      expect(uploadSpy).toHaveBeenNthCalledWith(
        3,
        requestContext,
        expect.objectContaining({ filePath: '/test/project/previews/outro.mp4' })
      );
      // Order already matches config order, no reorder call expected.
      expect(reorderMock).not.toHaveBeenCalled();
    });

    it('reorders previews when ASC order differs from config order', async () => {
      const config = new AppleConfigReader({
        info: {
          'en-US': {
            title: 'My App',
            previews: {
              IPHONE_67: ['./previews/a.mp4', './previews/b.mp4'],
            },
          },
        },
      });

      const locale = new AppStoreVersionLocalization(requestContext, 'LOC_1', {
        locale: 'en-US',
      } as any);

      // Both previews already exist (matching filename + size), so no upload happens.
      const previewA = new AppPreview(requestContext, 'PV_A', {
        fileName: 'a.mp4',
        fileSize: 10240,
        previewFrameTimeCode: null,
        assetDeliveryState: { state: 'COMPLETE', errors: [], warnings: [] },
      } as any);
      const previewB = new AppPreview(requestContext, 'PV_B', {
        fileName: 'b.mp4',
        fileSize: 10240,
        previewFrameTimeCode: null,
        assetDeliveryState: { state: 'COMPLETE', errors: [], warnings: [] },
      } as any);

      const previewTypeMap = new Map<PreviewType, AppPreviewSet>();
      // ASC reports them in [b, a] order — config wants [a, b].
      previewTypeMap.set(
        PreviewType.IPHONE_67,
        new AppPreviewSet(requestContext, 'PSET_1', {
          previewType: PreviewType.IPHONE_67,
          appPreviews: [previewB, previewA],
        } as any)
      );

      jest.spyOn(AppPreview, 'uploadAsync').mockResolvedValue(previewA);

      jest.spyOn(AppPreviewSet, 'infoAsync').mockResolvedValue(
        new AppPreviewSet(requestContext, 'PSET_1', {
          previewType: PreviewType.IPHONE_67,
          appPreviews: [previewB, previewA],
        } as any)
      );

      const reorderMock = jest.fn().mockResolvedValue([]);
      AppPreviewSet.prototype.reorderPreviewsAsync = reorderMock;

      const previewSets = new Map();
      previewSets.set('en-US', previewTypeMap);

      await new PreviewsTask().uploadAsync({
        config,
        context: {
          previewSets,
          versionLocales: [locale],
          projectDir: '/test/project',
        } as any,
      });

      expect(AppPreview.uploadAsync).not.toHaveBeenCalled();
      expect(reorderMock).toHaveBeenCalledWith({ appPreviews: ['PV_A', 'PV_B'] });
    });

    it('skips a preview type whose array is empty', async () => {
      const config = new AppleConfigReader({
        info: {
          'en-US': {
            title: 'My App',
            previews: {
              IPHONE_67: [],
            },
          },
        },
      });

      const locale = new AppStoreVersionLocalization(requestContext, 'LOC_1', {
        locale: 'en-US',
      } as any);

      jest.spyOn(AppPreview, 'uploadAsync');

      const previewSets = new Map();
      previewSets.set('en-US', new Map());

      await new PreviewsTask().uploadAsync({
        config,
        context: {
          previewSets,
          versionLocales: [locale],
          projectDir: '/test/project',
        } as any,
      });

      expect(AppPreview.uploadAsync).not.toHaveBeenCalled();
    });

    it('uploads new preview with object config including previewFrameTimeCode', async () => {
      const config = new AppleConfigReader({
        info: {
          'en-US': {
            title: 'My App',
            previews: {
              IPHONE_67: {
                path: './previews/demo.mp4',
                previewFrameTimeCode: '00:05:00',
              },
            },
          },
        },
      });

      const locale = new AppStoreVersionLocalization(requestContext, 'LOC_1', {
        locale: 'en-US',
      } as any);

      const newPreview = new AppPreview(requestContext, 'NEW_PV_1', {
        fileName: 'demo.mp4',
        fileSize: 10240,
        previewFrameTimeCode: '00:05:00',
        assetDeliveryState: { state: 'COMPLETE', errors: [], warnings: [] },
      } as any);

      const scope = nock('https://api.appstoreconnect.apple.com')
        // Create preview set
        .post(`/v1/${AppPreviewSet.type}`)
        .reply(201, {
          data: {
            id: 'NEW_PSET_1',
            type: AppPreviewSet.type,
            attributes: {
              previewType: PreviewType.IPHONE_67,
              appPreviews: [],
            },
          },
        });

      // Mock AppPreview.uploadAsync to avoid real file access
      jest.spyOn(AppPreview, 'uploadAsync').mockResolvedValue(newPreview);

      jest.spyOn(AppPreviewSet, 'infoAsync').mockResolvedValue(
        new AppPreviewSet(requestContext, 'NEW_PSET_1', {
          previewType: PreviewType.IPHONE_67,
          appPreviews: [newPreview],
        } as any)
      );

      const reorderMock = jest.fn().mockResolvedValue([]);
      AppPreviewSet.prototype.reorderPreviewsAsync = reorderMock;

      const previewSets = new Map();
      previewSets.set('en-US', new Map());

      await new PreviewsTask().uploadAsync({
        config,
        context: {
          previewSets,
          versionLocales: [locale],
          projectDir: '/test/project',
        } as any,
      });

      expect(scope.isDone()).toBeTruthy();
      expect(AppPreview.uploadAsync).toHaveBeenCalledWith(
        requestContext,
        expect.objectContaining({
          id: 'NEW_PSET_1',
          filePath: '/test/project/previews/demo.mp4',
          waitForProcessing: true,
          previewFrameTimeCode: '00:05:00',
        })
      );
    });
  });

  describe('downloadAsync (multi-preview)', () => {
    it('emits an array when there are multiple previews in a set', async () => {
      const writer = jest.mocked(new AppleConfigWriter());

      const previews = [
        new AppPreview(requestContext, 'PV_1', {
          fileName: 'intro.mp4',
          fileSize: 10240,
          previewFrameTimeCode: null,
          videoUrl: 'https://example.com/intro.mp4',
          assetDeliveryState: { state: 'COMPLETE', errors: [], warnings: [] },
        } as any),
        new AppPreview(requestContext, 'PV_2', {
          fileName: 'features.mp4',
          fileSize: 10240,
          previewFrameTimeCode: '00:01:00',
          videoUrl: 'https://example.com/features.mp4',
          assetDeliveryState: { state: 'COMPLETE', errors: [], warnings: [] },
        } as any),
      ];

      jest.spyOn(previews[0], 'getVideoUrl').mockReturnValue('https://example.com/intro.mp4');
      jest.spyOn(previews[1], 'getVideoUrl').mockReturnValue('https://example.com/features.mp4');

      const previewTypeMap = new Map<PreviewType, AppPreviewSet>();
      previewTypeMap.set(
        PreviewType.IPHONE_67,
        new AppPreviewSet(requestContext, 'PSET_1', {
          previewType: PreviewType.IPHONE_67,
          appPreviews: previews,
        } as any)
      );

      const locale = new AppStoreVersionLocalization(requestContext, 'LOC_1', {
        locale: 'en-US',
      } as any);

      mockFetch.mockResolvedValue({
        ok: true,
        buffer: () => Promise.resolve(Buffer.from('fake-video-data')),
      });

      await new PreviewsTask().downloadAsync({
        config: writer,
        context: {
          previewSets: new Map([['en-US', previewTypeMap]]),
          versionLocales: [locale],
          projectDir: '/test/project',
        } as any,
      });

      expect(writer.setPreviews).toBeCalledWith('en-US', {
        [PreviewType.IPHONE_67]: [
          'store/apple/preview/en-US/IPHONE_67/intro.mp4',
          {
            path: 'store/apple/preview/en-US/IPHONE_67/features.mp4',
            previewFrameTimeCode: '00:01:00',
          },
        ],
      });
    });
  });
});
