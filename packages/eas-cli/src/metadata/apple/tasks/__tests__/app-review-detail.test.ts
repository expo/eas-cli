import { AppStoreReviewAttachment, AppStoreReviewDetail, AppStoreVersion } from '@expo/apple-utils';
import crypto from 'crypto';
import fs from 'fs';
import nock from 'nock';

import { requestContext } from './fixtures/requestContext';
import { AppleConfigReader } from '../../config/reader';
import { AppleConfigWriter } from '../../config/writer';
import { AppReviewDetailTask } from '../app-review-detail';

jest.mock('../../../../ora');
jest.mock('../../config/writer');

function md5(value: Buffer | string): string {
  return crypto.createHash('md5').update(value).digest('hex');
}

describe(AppReviewDetailTask, () => {
  describe('prepareAsync', () => {
    it('loads review details from app version', async () => {
      const scope = nock('https://api.appstoreconnect.apple.com')
        .get(`/v1/${AppStoreVersion.type}/stub-id/appStoreReviewDetail`)
        .query((params: any) => params['include'] === AppStoreReviewAttachment.type)
        .reply(200, require('./fixtures/appStoreVersions/get-appStoreReviewDetail-200.json'));

      const context: any = {
        version: new AppStoreVersion(requestContext, 'stub-id', {} as any),
      };

      await new AppReviewDetailTask().prepareAsync({ context });

      expect(context.reviewDetail).toBeInstanceOf(AppStoreReviewDetail);
      expect(scope.isDone()).toBeTruthy();
    });
  });

  describe('downloadAsync', () => {
    it('sets review details when loaded', async () => {
      const writer = jest.mocked(new AppleConfigWriter());
      const reviewDetail = new AppStoreReviewDetail(requestContext, 'stub-id', {} as any);

      await new AppReviewDetailTask().downloadAsync({
        config: writer,
        context: { reviewDetail } as any,
      });

      expect(writer.setReviewDetails).toBeCalledWith(reviewDetail.attributes);
    });

    it('skips when no review details are loaded', async () => {
      const writer = jest.mocked(new AppleConfigWriter());

      await new AppReviewDetailTask().downloadAsync({
        config: writer,
        context: {} as any,
      });

      expect(writer.setReviewDetails).not.toBeCalled();
    });

    it('records the review attachment placeholder path when one exists', async () => {
      const writer = jest.mocked(new AppleConfigWriter());
      const attachment = new AppStoreReviewAttachment(requestContext, 'ATTACH_1', {
        fileName: 'demo-instructions.pdf',
        fileSize: 1024,
        sourceFileChecksum: 'abc123',
        uploaded: true,
      } as any);
      const reviewDetail = new AppStoreReviewDetail(requestContext, 'stub-id', {
        appStoreReviewAttachments: [attachment],
      } as any);

      const existsSyncSpy = jest.spyOn(fs, 'existsSync').mockReturnValue(true);

      await new AppReviewDetailTask().downloadAsync({
        config: writer,
        context: { reviewDetail, projectDir: '/test/project' } as any,
      });

      expect(writer.setReviewDetails).toBeCalledWith(reviewDetail.attributes);
      expect(writer.setReviewAttachment).toBeCalledWith(
        'store/apple/review-attachment/demo-instructions.pdf'
      );

      existsSyncSpy.mockRestore();
    });

    it('does not call setReviewAttachment when there is no attachment', async () => {
      const writer = jest.mocked(new AppleConfigWriter());
      const reviewDetail = new AppStoreReviewDetail(requestContext, 'stub-id', {
        appStoreReviewAttachments: [],
      } as any);

      await new AppReviewDetailTask().downloadAsync({
        config: writer,
        context: { reviewDetail, projectDir: '/test/project' } as any,
      });

      expect(writer.setReviewAttachment).not.toBeCalled();
    });
  });

  describe('uploadAsync', () => {
    it('skips when review details are not configured', async () => {
      const scope = nock('https://api.appstoreconnect.apple.com')
        .post(`/v1/${AppStoreReviewDetail.type}`)
        .reply(201, require('./fixtures/appStoreReviewDetails/post-201.json'));

      await new AppReviewDetailTask().uploadAsync({
        config: new AppleConfigReader({
          review: undefined,
        }),
        context: {
          version: new AppStoreVersion(requestContext, 'stub-id', {} as any),
        } as any,
      });

      expect(scope.isDone()).toBeFalsy();
      nock.cleanAll();
    });

    it('skips when version is not loaded', async () => {
      await expect(
        new AppReviewDetailTask().uploadAsync({
          config: new AppleConfigReader({
            review: {
              firstName: 'Evan',
              lastName: 'Bacon',
              email: 'review@example.com',
              phone: '+1 555 555 5555',
            },
          }),
          context: {} as any,
        })
      ).resolves.not.toThrow();
    });

    it('updates review details when loaded', async () => {
      const scope = nock('https://api.appstoreconnect.apple.com')
        .patch(`/v1/${AppStoreReviewDetail.type}/APP_STORE_REVIEW_DETAILS_1`)
        .reply(200, require('./fixtures/appStoreReviewDetails/patch-200.json'));

      await new AppReviewDetailTask().uploadAsync({
        config: new AppleConfigReader({
          review: {
            firstName: 'Evan',
            lastName: 'Bacon',
            email: 'review@example.com',
            phone: '+1 555 555 5555',
          },
        }),
        context: {
          version: new AppStoreVersion(requestContext, 'stub-id', {} as any),
          reviewDetail: new AppStoreReviewDetail(
            requestContext,
            'APP_STORE_REVIEW_DETAILS_1',
            {} as any
          ),
        } as any,
      });

      expect(scope.isDone()).toBeTruthy();
    });

    it('creates and updates review details when not loaded', async () => {
      const createReviewDetailScope = nock('https://api.appstoreconnect.apple.com')
        .post(`/v1/${AppStoreReviewDetail.type}`)
        .reply(201, require('./fixtures/appStoreReviewDetails/post-201.json'));

      const updateReviewDetailScope = nock('https://api.appstoreconnect.apple.com')
        .patch(`/v1/${AppStoreReviewDetail.type}/APP_STORE_REVIEW_DETAILS_1`)
        .reply(200, require('./fixtures/appStoreReviewDetails/patch-200.json'));

      await new AppReviewDetailTask().uploadAsync({
        config: new AppleConfigReader({
          review: {
            firstName: 'Evan',
            lastName: 'Bacon',
            email: 'review@example.com',
            phone: '+1 555 555 5555',
          },
        }),
        context: {
          version: new AppStoreVersion(requestContext, 'stub-id', {} as any),
        } as any,
      });

      expect(createReviewDetailScope.isDone()).toBeTruthy();
      expect(updateReviewDetailScope.isDone()).toBeTruthy();
    });

    describe('attachment sync', () => {
      const fileBytes = Buffer.from('file-bytes');
      const fileChecksum = md5(fileBytes);

      let existsSyncSpy: jest.SpyInstance;
      let readFileSyncSpy: jest.SpyInstance;

      beforeEach(() => {
        existsSyncSpy = jest.spyOn(fs, 'existsSync').mockReturnValue(true);
        readFileSyncSpy = jest.spyOn(fs, 'readFileSync').mockReturnValue(fileBytes as any);
      });

      afterEach(() => {
        existsSyncSpy.mockRestore();
        readFileSyncSpy.mockRestore();
        jest.restoreAllMocks();
        nock.cleanAll();
      });

      it('uploads a new attachment when none exists', async () => {
        nock('https://api.appstoreconnect.apple.com')
          .patch(`/v1/${AppStoreReviewDetail.type}/APP_STORE_REVIEW_DETAILS_1`)
          .reply(200, require('./fixtures/appStoreReviewDetails/patch-200.json'));

        const reviewDetail = new AppStoreReviewDetail(
          requestContext,
          'APP_STORE_REVIEW_DETAILS_1',
          { appStoreReviewAttachments: [] } as any
        );
        const uploadSpy = jest
          .spyOn(AppStoreReviewDetail.prototype, 'uploadAttachmentAsync')
          .mockResolvedValue({} as any);

        await new AppReviewDetailTask().uploadAsync({
          config: new AppleConfigReader({
            review: {
              firstName: 'Evan',
              lastName: 'Bacon',
              email: 'review@example.com',
              phone: '+1 555 555 5555',
              attachment: 'store/apple/review-attachment/demo.pdf',
            },
          }),
          context: {
            version: new AppStoreVersion(requestContext, 'stub-id', {} as any),
            reviewDetail,
            projectDir: '/test/project',
          } as any,
        });

        expect(uploadSpy).toBeCalledTimes(1);
        expect(uploadSpy).toBeCalledWith(
          expect.stringContaining('store/apple/review-attachment/demo.pdf')
        );
      });

      it('skips upload when checksum matches existing attachment', async () => {
        nock('https://api.appstoreconnect.apple.com')
          .patch(`/v1/${AppStoreReviewDetail.type}/APP_STORE_REVIEW_DETAILS_1`)
          .reply(200, require('./fixtures/appStoreReviewDetails/patch-200.json'));

        const existing = new AppStoreReviewAttachment(requestContext, 'ATTACH_1', {
          fileName: 'demo.pdf',
          fileSize: fileBytes.length,
          sourceFileChecksum: fileChecksum,
          uploaded: true,
        } as any);
        const reviewDetail = new AppStoreReviewDetail(
          requestContext,
          'APP_STORE_REVIEW_DETAILS_1',
          { appStoreReviewAttachments: [existing] } as any
        );
        const uploadSpy = jest
          .spyOn(AppStoreReviewDetail.prototype, 'uploadAttachmentAsync')
          .mockResolvedValue({} as any);
        const deleteSpy = jest.spyOn(existing, 'deleteAsync').mockResolvedValue(undefined);

        await new AppReviewDetailTask().uploadAsync({
          config: new AppleConfigReader({
            review: {
              firstName: 'Evan',
              lastName: 'Bacon',
              email: 'review@example.com',
              phone: '+1 555 555 5555',
              attachment: 'store/apple/review-attachment/demo.pdf',
            },
          }),
          context: {
            version: new AppStoreVersion(requestContext, 'stub-id', {} as any),
            reviewDetail,
            projectDir: '/test/project',
          } as any,
        });

        expect(uploadSpy).not.toBeCalled();
        expect(deleteSpy).not.toBeCalled();
      });

      it('replaces stale attachment when checksum differs', async () => {
        nock('https://api.appstoreconnect.apple.com')
          .patch(`/v1/${AppStoreReviewDetail.type}/APP_STORE_REVIEW_DETAILS_1`)
          .reply(200, require('./fixtures/appStoreReviewDetails/patch-200.json'));

        const existing = new AppStoreReviewAttachment(requestContext, 'ATTACH_OLD', {
          fileName: 'old.pdf',
          fileSize: 5,
          sourceFileChecksum: 'different-checksum',
          uploaded: true,
        } as any);
        const reviewDetail = new AppStoreReviewDetail(
          requestContext,
          'APP_STORE_REVIEW_DETAILS_1',
          { appStoreReviewAttachments: [existing] } as any
        );
        const uploadSpy = jest
          .spyOn(AppStoreReviewDetail.prototype, 'uploadAttachmentAsync')
          .mockResolvedValue({} as any);
        const deleteSpy = jest.spyOn(existing, 'deleteAsync').mockResolvedValue(undefined);

        await new AppReviewDetailTask().uploadAsync({
          config: new AppleConfigReader({
            review: {
              firstName: 'Evan',
              lastName: 'Bacon',
              email: 'review@example.com',
              phone: '+1 555 555 5555',
              attachment: 'store/apple/review-attachment/demo.pdf',
            },
          }),
          context: {
            version: new AppStoreVersion(requestContext, 'stub-id', {} as any),
            reviewDetail,
            projectDir: '/test/project',
          } as any,
        });

        expect(deleteSpy).toBeCalledTimes(1);
        expect(uploadSpy).toBeCalledTimes(1);
      });

      it('warns and skips when local attachment file is missing', async () => {
        nock('https://api.appstoreconnect.apple.com')
          .patch(`/v1/${AppStoreReviewDetail.type}/APP_STORE_REVIEW_DETAILS_1`)
          .reply(200, require('./fixtures/appStoreReviewDetails/patch-200.json'));

        existsSyncSpy.mockReturnValue(false);

        const reviewDetail = new AppStoreReviewDetail(
          requestContext,
          'APP_STORE_REVIEW_DETAILS_1',
          { appStoreReviewAttachments: [] } as any
        );
        const uploadSpy = jest
          .spyOn(AppStoreReviewDetail.prototype, 'uploadAttachmentAsync')
          .mockResolvedValue({} as any);

        await new AppReviewDetailTask().uploadAsync({
          config: new AppleConfigReader({
            review: {
              firstName: 'Evan',
              lastName: 'Bacon',
              email: 'review@example.com',
              phone: '+1 555 555 5555',
              attachment: 'store/apple/review-attachment/missing.pdf',
            },
          }),
          context: {
            version: new AppStoreVersion(requestContext, 'stub-id', {} as any),
            reviewDetail,
            projectDir: '/test/project',
          } as any,
        });

        expect(uploadSpy).not.toBeCalled();
      });
    });
  });
});
