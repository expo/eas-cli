import {
  App,
  AppStoreState,
  AppStoreVersion,
  AppStoreVersionLocalization,
} from '@expo/apple-utils';
import nock from 'nock';

import { AppleConfigReader } from '../../config/reader';
import { AppleContext, PartialAppleContext } from '../../context';
import { AppVersionTask } from '../app-version';
import { requestContext } from './fixtures/requestContext';

describe(AppVersionTask, () => {
  describe('preuploadAsync', () => {
    it('loads live version', async () => {
      const scope = nock('https://api.appstoreconnect.apple.com')
        // Respond to app.getLiveAppStoreVersionAsync
        .get(`/v1/${App.type}/stub-id/${AppStoreVersion.type}`)
        .query((params: any) => params['filter[appStoreState]'] === AppStoreState.READY_FOR_SALE)
        .reply(200, require('./fixtures/apps/get-appStoreVersions-200.json'))
        // Respond to app.getAppStoreVersionsAsync
        .get(`/v1/${App.type}/stub-id/${AppStoreVersion.type}`)
        .query((params: any) => params['filter[appStoreState]'] !== AppStoreState.READY_FOR_SALE)
        .reply(200, require('./fixtures/apps/get-appStoreVersions-count-200.json'))
        // Respond to version.getLocalizationsAsync
        .get(`/v1/${AppStoreVersion.type}/APP_STORE_VERSION_1/${AppStoreVersionLocalization.type}`)
        .reply(
          200,
          require('./fixtures/appStoreVersions/get-appStoreVersionLocalizations-200.json')
        );

      const context: PartialAppleContext = {
        app: new App(requestContext, 'stub-id', {} as any),
      };

      await new AppVersionTask({ editLive: true }).prepareAsync({ context });

      expect(context.version).toBeInstanceOf(AppStoreVersion);
      expect(context.versionIsLive).toBeTruthy();
      expect(context.versionIsFirst).toBeTruthy();
      expect(scope.isDone()).toBeTruthy();
    });

    it('falls back to editable version if live version is not found', async () => {
      const scope = nock('https://api.appstoreconnect.apple.com')
        // Respond to app.getLiveAppStoreVersionAsync, failing with 404
        .get(`/v1/${App.type}/stub-id/${AppStoreVersion.type}`)
        .query((params: any) => params['filter[appStoreState]'] === AppStoreState.READY_FOR_SALE)
        .reply(404, {})
        // Respond to app.getEditAppStoreVersionAsync
        .get(`/v1/${App.type}/stub-id/${AppStoreVersion.type}`)
        .query((params: any) => params['filter[appStoreState]'] !== AppStoreState.READY_FOR_SALE)
        .reply(200, require('./fixtures/apps/get-appStoreVersions-count-200.json'))
        // Respond to app.getAppStoreVersionsAsync
        .get(`/v1/${App.type}/stub-id/${AppStoreVersion.type}`)
        .query(true)
        .reply(200, require('./fixtures/apps/get-appStoreVersions-count-200.json'))
        // Respond to version.getLocalizationsAsync
        .get(`/v1/${AppStoreVersion.type}/APP_STORE_VERSION_1/${AppStoreVersionLocalization.type}`)
        .reply(
          200,
          require('./fixtures/appStoreVersions/get-appStoreVersionLocalizations-200.json')
        );

      const context: PartialAppleContext = {
        app: new App(requestContext, 'stub-id', {} as any),
      };

      await new AppVersionTask({ editLive: true }).prepareAsync({ context });

      expect(context.version).toBeInstanceOf(AppStoreVersion);
      expect(context.versionIsLive).toBeFalsy();
      expect(context.versionIsFirst).toBeTruthy();
      expect(scope.isDone()).toBeTruthy();
    });

    it('loads last editable version', async () => {
      const scope = nock('https://api.appstoreconnect.apple.com')
        // Respond to app.getEditAppStoreVersionAsync
        .get(`/v1/${App.type}/stub-id/${AppStoreVersion.type}`)
        .query((params: any) => params['filter[appStoreState]'] !== AppStoreState.READY_FOR_SALE)
        .reply(200, require('./fixtures/apps/get-appStoreVersions-200.json'))
        // Respond to app.getAppStoreVersionsAsync
        .get(`/v1/${App.type}/stub-id/${AppStoreVersion.type}`)
        .query((params: any) => params['filter[appStoreState]'] !== AppStoreState.READY_FOR_SALE)
        .reply(200, require('./fixtures/apps/get-appStoreVersions-count-200.json'))
        // Respond to version.getLocalizationsAsync
        .get(`/v1/${AppStoreVersion.type}/APP_STORE_VERSION_1/${AppStoreVersionLocalization.type}`)
        .reply(
          200,
          require('./fixtures/appStoreVersions/get-appStoreVersionLocalizations-200.json')
        );

      const context: PartialAppleContext = {
        app: new App(requestContext, 'stub-id', {} as any),
      };

      await new AppVersionTask().prepareAsync({ context });

      expect(context.version).toBeInstanceOf(AppStoreVersion);
      expect(context.versionIsLive).toBeFalsy();
      expect(context.versionIsFirst).toBeTruthy();
      expect(scope.isDone()).toBeTruthy();
    });

    it('sets first version property for multiple versions', async () => {
      const scope = nock('https://api.appstoreconnect.apple.com')
        // Respond to app.getEditAppStoreVersionAsync
        .get(`/v1/${App.type}/stub-id/${AppStoreVersion.type}`)
        .query((params: any) => params['filter[appStoreState]'] !== AppStoreState.READY_FOR_SALE)
        .reply(200, require('./fixtures/apps/get-appStoreVersions-200.json'))
        // Respond to app.getAppStoreVersionsAsync
        .get(`/v1/${App.type}/stub-id/${AppStoreVersion.type}`)
        .query((params: any) => params['filter[appStoreState]'] !== AppStoreState.READY_FOR_SALE)
        .reply(200, require('./fixtures/apps/get-appStoreVersions-count-multiple-200.json'))
        // Respond to version.getLocalizationsAsync
        .get(`/v1/${AppStoreVersion.type}/APP_STORE_VERSION_1/${AppStoreVersionLocalization.type}`)
        .reply(
          200,
          require('./fixtures/appStoreVersions/get-appStoreVersionLocalizations-200.json')
        );

      const context: PartialAppleContext = {
        app: new App(requestContext, 'stub-id', {} as any),
      };

      await new AppVersionTask().prepareAsync({ context });

      expect(context.versionIsFirst).toBeFalsy();
      expect(scope.isDone()).toBeTruthy();
    });
  });

  describe('upload', () => {
    it('aborts when version is not loaded', async () => {
      const promise = new AppVersionTask().uploadAsync({
        context: {} as any,
        config: new AppleConfigReader({}),
      });

      await expect(promise).rejects.toThrow('not initialized');
    });

    it('updates version and release from config', async () => {
      const config = new AppleConfigReader({
        copyright: '2022 ACME',
        release: { automaticRelease: true },
      });

      const attributes = { ...config.getVersion(), ...config.getVersionRelease() };
      const scope = nock('https://api.appstoreconnect.apple.com')
        // Respond to version.updateAsync
        .patch(`/v1/${AppStoreVersion.type}/APP_STORE_VERSION_1`)
        .reply(200, {
          data: {
            id: 'APP_STORE_VERSION_1',
            type: AppStoreVersion.type,
            attributes,
          },
        });

      const context: PartialAppleContext = {
        app: new App(requestContext, 'stub-id', {} as any),
        version: new AppStoreVersion(requestContext, 'APP_STORE_VERSION_1', {} as any),
      };

      await new AppVersionTask().uploadAsync({ context: context as AppleContext, config });

      expect(context.version?.attributes).toMatchObject(attributes);
      expect(scope.isDone()).toBeTruthy();
    });
  });
});
