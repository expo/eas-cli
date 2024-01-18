import { AppStoreReviewAttachment, AppStoreReviewDetail, AppStoreVersion } from '@expo/apple-utils';
import nock from 'nock';

import { requestContext } from './fixtures/requestContext';
import { AppleConfigReader } from '../../config/reader';
import { AppleConfigWriter } from '../../config/writer';
import { AppReviewDetailTask } from '../app-review-detail';

jest.mock('../../../../ora');
jest.mock('../../config/writer');

describe(AppReviewDetailTask, () => {
  describe('prepareAsync', () => {
    it('aborts when version is not loaded', async () => {
      const promise = new AppReviewDetailTask().prepareAsync({ context: {} as any });

      await expect(promise).rejects.toThrow('version not init');
    });

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

    it('aborts when version is not loaded', async () => {
      const promise = new AppReviewDetailTask().uploadAsync({
        config: new AppleConfigReader({
          review: {
            firstName: 'Evan',
            lastName: 'Bacon',
            email: 'review@example.com',
            phone: '+1 555 555 5555',
          },
        }),
        context: {} as any,
      });

      await expect(promise).rejects.toThrow('version not init');
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
  });
});
