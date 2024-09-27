import { AgeRatingDeclaration, AppStoreVersion, Rating } from '@expo/apple-utils';
import nock from 'nock';

import { requestContext } from './fixtures/requestContext';
import { AppleConfigReader } from '../../config/reader';
import { AppleConfigWriter } from '../../config/writer';
import { AppleData } from '../../data';
import { AgeRatingTask } from '../age-rating';

jest.mock('../../../../ora');
jest.mock('../../config/writer');

describe(AgeRatingTask, () => {
  describe('prepareAsync', () => {
    it('aborts when version is not loaded', async () => {
      const promise = new AgeRatingTask().prepareAsync({ context: {} as any });

      await expect(promise).rejects.toThrow('not prepared');
    });

    it('loads age rating from app version', async () => {
      const scope = nock('https://api.appstoreconnect.apple.com')
        .get(`/v1/${AppStoreVersion.type}/stub-id/ageRatingDeclaration`)
        .reply(200, require('./fixtures/appStoreVersions/get-ageRatingDeclaration-200.json'));

      const context: any = {
        version: new AppStoreVersion(requestContext, 'stub-id', {} as any),
      };

      await new AgeRatingTask().prepareAsync({ context });

      expect(context.ageRating).toBeInstanceOf(AgeRatingDeclaration);
      expect(scope.isDone()).toBeTruthy();
    });
  });

  describe('downloadAsync', () => {
    it('skips age rating when not prepared', async () => {
      const writer = jest.mocked(new AppleConfigWriter());

      await new AgeRatingTask().downloadAsync({
        config: writer,
        context: { ageRating: undefined } as any,
      });

      expect(writer.setAgeRating).not.toBeCalled();
    });

    it('sets age rating when prepared', async () => {
      const writer = jest.mocked(new AppleConfigWriter());
      const ageRating = new AgeRatingDeclaration(requestContext, 'stub-id', {} as any);

      await new AgeRatingTask().downloadAsync({
        config: writer,
        context: { ageRating } as any,
      });

      expect(writer.setAgeRating).toBeCalledWith(ageRating.attributes);
    });
  });

  describe('uploadAsync', () => {
    it('aborts when age rating is not loaded', async () => {
      const promise = new AgeRatingTask().uploadAsync({
        config: new AppleConfigReader({}),
        context: { ageRating: undefined } as any,
      });

      await expect(promise).rejects.toThrow('rating not initialized');
    });

    it('skips updating age rating when not configured', async () => {
      const scope = nock('https://api.appstoreconnect.apple.com')
        .patch(`/v1/${AgeRatingDeclaration.type}/stub-id`)
        .reply(200, require('./fixtures/ageRatingDeclarations/patch-200.json'));

      await new AgeRatingTask().uploadAsync({
        config: new AppleConfigReader({ advisory: undefined }),
        context: {
          ageRating: new AgeRatingDeclaration(requestContext, 'stub-id', {} as any),
        } as AppleData,
      });

      expect(scope.isDone()).toBeFalsy();
      nock.cleanAll();
    });

    it('updates age rating from config when configured', async () => {
      const scope = nock('https://api.appstoreconnect.apple.com')
        .patch(`/v1/${AgeRatingDeclaration.type}/stub-id`)
        .reply(200, require('./fixtures/ageRatingDeclarations/patch-200.json'));

      const context = {
        ageRating: new AgeRatingDeclaration(requestContext, 'stub-id', {} as any),
      };

      await new AgeRatingTask().uploadAsync({
        config: new AppleConfigReader({
          advisory: {
            // See fixture value for horrorOrFearThemes
            horrorOrFearThemes: Rating.INFREQUENT_OR_MILD,
          },
        }),
        context: context as AppleData,
      });

      expect(context.ageRating.id).not.toMatch('stub-id');
      expect(scope.isDone()).toBeTruthy();
    });
  });
});
