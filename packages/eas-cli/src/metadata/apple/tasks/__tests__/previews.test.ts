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
});
