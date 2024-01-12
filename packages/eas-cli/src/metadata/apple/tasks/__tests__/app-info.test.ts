import { App, AppCategoryId, AppInfo, AppInfoLocalization } from '@expo/apple-utils';
import nock from 'nock';

import { requestContext } from './fixtures/requestContext';
import { AppleConfigReader } from '../../config/reader';
import { AppleConfigWriter } from '../../config/writer';
import { AppleData, PartialAppleData } from '../../data';
import { AppInfoTask } from '../app-info';

jest.mock('../../../../ora');
jest.mock('../../config/writer');

describe(AppInfoTask, () => {
  describe('prepareAsync', () => {
    it('loads editable app info and locales from app instance', async () => {
      const scopeInfo = nock('https://api.appstoreconnect.apple.com')
        .get(uri => uri.startsWith(`/v1/${App.type}/stub-id/${AppInfo.type}`)) // allow any query params
        .reply(200, require('./fixtures/apps/get-appInfos-200.json'));

      const scopeLocales = nock('https://api.appstoreconnect.apple.com')
        .get(/\/v1\/appInfos\/.*\/appInfoLocalizations/) // allow any id from fixture
        .reply(200, require('./fixtures/appInfos/get-appInfoLocalizations-200.json'));

      const context: PartialAppleData = {
        app: new App(requestContext, 'stub-id', {} as any),
      };

      await new AppInfoTask().prepareAsync({ context });

      expect(context.info).toBeInstanceOf(AppInfo);
      expect(context.infoLocales).toBeInstanceOf(Array);
      expect(scopeInfo.isDone()).toBeTruthy();
      expect(scopeLocales.isDone()).toBeTruthy();
    });
  });

  describe('downloadAsync', () => {
    it('aborts when app info is not loaded', async () => {
      const writer = jest.mocked(new AppleConfigWriter());
      const promise = new AppInfoTask().downloadAsync({
        config: writer,
        context: { info: undefined, infoLocales: [] } as any,
      });

      await expect(promise).rejects.toThrow('info not initialized');
    });

    it('sets categories when info is loaded', async () => {
      const writer = jest.mocked(new AppleConfigWriter());
      const info = new AppInfo(requestContext, 'stub-id', {} as any);

      await new AppInfoTask().downloadAsync({
        config: writer,
        context: { info, infoLocales: [] } as any,
      });

      expect(writer.setCategories).toBeCalledWith(info.attributes);
    });

    it('skips when no locales are loaded', async () => {
      const writer = jest.mocked(new AppleConfigWriter());

      await new AppInfoTask().downloadAsync({
        config: writer,
        context: {
          info: new AppInfo(requestContext, 'stub-id', {} as any),
          infoLocales: [],
        } as any,
      });

      expect(writer.setInfoLocale).not.toBeCalled();
    });

    it('sets locales when loaded', async () => {
      const writer = jest.mocked(new AppleConfigWriter());
      const infoLocales = [
        new AppInfoLocalization(requestContext, 'stub-id-1', {} as any),
        new AppInfoLocalization(requestContext, 'stub-id-2', {} as any),
      ];

      await new AppInfoTask().downloadAsync({
        config: writer,
        context: {
          info: new AppInfo(requestContext, 'stub-id', {} as any),
          infoLocales,
        } as any,
      });

      expect(writer.setInfoLocale).toBeCalledWith(infoLocales[0].attributes);
      expect(writer.setInfoLocale).toBeCalledWith(infoLocales[1].attributes);
    });
  });

  describe('uploadAsync', () => {
    it('aborts when app info is not loaded', async () => {
      const promise = new AppInfoTask().uploadAsync({
        config: new AppleConfigReader({}),
        context: { info: undefined } as any,
      });

      await expect(promise).rejects.toThrow('info not initialized');
    });

    it('skips updating categories when not configured', async () => {
      const scope = nock('https://api.appstoreconnect.apple.com')
        .patch(`/v1/${AppInfo.type}/stub-id`)
        .reply(200, require('./fixtures/appInfos/patch-200.json'));

      await new AppInfoTask().uploadAsync({
        config: new AppleConfigReader({ categories: undefined }),
        context: {
          info: new AppInfo(requestContext, 'stub-id', {} as any),
        } as AppleData,
      });

      expect(scope.isDone()).toBeFalsy();
      nock.cleanAll();
    });

    it('skips updating localized info when not configured', async () => {
      const scope = nock('https://api.appstoreconnect.apple.com')
        .patch(`/v1/${AppInfoLocalization.type}/stub-id`)
        .reply(200, require('./fixtures/appInfos/patch-200.json'));

      await new AppInfoTask().uploadAsync({
        config: new AppleConfigReader({ info: undefined }),
        context: {
          info: new AppInfo(requestContext, 'stub-id', {} as any),
        } as AppleData,
      });

      expect(scope.isDone()).toBeFalsy();
      nock.cleanAll();
    });

    it('updates categories and localized info', async () => {
      const updateCategoryScope = nock('https://api.appstoreconnect.apple.com')
        .patch(`/v1/${AppInfo.type}/stub-id`)
        .reply(200, require('./fixtures/appInfos/patch-200.json'));

      const updateENInfoScope = nock('https://api.appstoreconnect.apple.com')
        .patch(`/v1/${AppInfoLocalization.type}/APP_INFO_LOCALE_1`) // see fixture ID
        .reply(200, require('./fixtures/appInfoLocalizations/patch-200.json'));

      const updateNLInfoScope = nock('https://api.appstoreconnect.apple.com')
        .patch(`/v1/${AppInfoLocalization.type}/APP_INFO_LOCALE_2`) // see fixture ID
        .reply(200, require('./fixtures/appInfoLocalizations/patch-200.json'));

      const fetchLocalizedInfoScope = nock('https://api.appstoreconnect.apple.com')
        .get(`/v1/${AppInfo.type}/APP_INFO_1/${AppInfoLocalization.type}`) // see fixture ID
        .twice()
        .reply(200, require('./fixtures/appInfos/get-appInfoLocalizations-200.json'));

      await new AppInfoTask().uploadAsync({
        config: new AppleConfigReader({
          categories: [AppCategoryId.ENTERTAINMENT],
          info: {
            'en-US': { title: 'Hello' },
            'nl-NL': { title: 'Hallo' },
          },
        }),
        context: {
          info: new AppInfo(requestContext, 'stub-id', {} as any),
        } as AppleData,
      });

      expect(updateCategoryScope.isDone()).toBeTruthy();
      expect(fetchLocalizedInfoScope.isDone()).toBeTruthy();
      expect(updateENInfoScope.isDone()).toBeTruthy();
      expect(updateNLInfoScope.isDone()).toBeTruthy();
    });
  });
});
