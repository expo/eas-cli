import {
  App,
  AppStoreState,
  AppStoreVersion,
  AppStoreVersionLocalization,
  AppStoreVersionPhasedRelease,
  PhasedReleaseState,
} from '@expo/apple-utils';
import nock from 'nock';

import { requestContext } from './fixtures/requestContext';
import { AppleConfigReader } from '../../config/reader';
import { AppleConfigWriter } from '../../config/writer';
import { AppleData, PartialAppleData } from '../../data';
import { AppVersionTask } from '../app-version';

jest.mock('../../../../ora');
jest.mock('../../config/writer');

describe(AppVersionTask, () => {
  describe('prepareAsync', () => {
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
        // Respond to version.getPhasedReleaseAsync
        .get(`/v1/${AppStoreVersion.type}/APP_STORE_VERSION_1/appStoreVersionPhasedRelease`)
        .reply(
          200,
          require('./fixtures/appStoreVersions/get-appStoreVersionPhasedRelease-200-empty.json')
        )
        // Respond to version.getLocalizationsAsync
        .get(`/v1/${AppStoreVersion.type}/APP_STORE_VERSION_1/${AppStoreVersionLocalization.type}`)
        .reply(
          200,
          require('./fixtures/appStoreVersions/get-appStoreVersionLocalizations-200.json')
        );

      const context: PartialAppleData = {
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
        // Respond to version.getPhasedReleaseAsync
        .get(`/v1/${AppStoreVersion.type}/APP_STORE_VERSION_1/appStoreVersionPhasedRelease`)
        .reply(
          200,
          require('./fixtures/appStoreVersions/get-appStoreVersionPhasedRelease-200-empty.json')
        )
        // Respond to version.getLocalizationsAsync
        .get(`/v1/${AppStoreVersion.type}/APP_STORE_VERSION_1/${AppStoreVersionLocalization.type}`)
        .reply(
          200,
          require('./fixtures/appStoreVersions/get-appStoreVersionLocalizations-200.json')
        );

      const context: PartialAppleData = {
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
        // Respond to version.getPhasedReleaseAsync
        .get(`/v1/${AppStoreVersion.type}/APP_STORE_VERSION_1/appStoreVersionPhasedRelease`)
        .reply(
          200,
          require('./fixtures/appStoreVersions/get-appStoreVersionPhasedRelease-200-empty.json')
        )
        // Respond to version.getLocalizationsAsync
        .get(`/v1/${AppStoreVersion.type}/APP_STORE_VERSION_1/${AppStoreVersionLocalization.type}`)
        .reply(
          200,
          require('./fixtures/appStoreVersions/get-appStoreVersionLocalizations-200.json')
        );

      const context: PartialAppleData = {
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
        // Respond to version.getPhasedReleaseAsync
        .get(`/v1/${AppStoreVersion.type}/APP_STORE_VERSION_1/appStoreVersionPhasedRelease`)
        .reply(
          200,
          require('./fixtures/appStoreVersions/get-appStoreVersionPhasedRelease-200-empty.json')
        )
        // Respond to version.getLocalizationsAsync
        .get(`/v1/${AppStoreVersion.type}/APP_STORE_VERSION_1/${AppStoreVersionLocalization.type}`)
        .reply(
          200,
          require('./fixtures/appStoreVersions/get-appStoreVersionLocalizations-200.json')
        );

      const context: PartialAppleData = {
        app: new App(requestContext, 'stub-id', {} as any),
      };

      await new AppVersionTask().prepareAsync({ context });

      expect(context.versionIsFirst).toBeFalsy();
      expect(scope.isDone()).toBeTruthy();
    });

    it('fetches the existing version from options', async () => {
      const scope = nock('https://api.appstoreconnect.apple.com')
        // Respond to app.getAppStoreVersionsAsync in findEditAppStoreVersionAsync
        .get(`/v1/${App.type}/stub-id/${AppStoreVersion.type}`)
        .query(true)
        .reply(200, require('./fixtures/apps/get-appStoreVersions-count-multiple-200'))
        // Respond to app.getAppStoreVersionsAsync
        .get(`/v1/${App.type}/stub-id/${AppStoreVersion.type}`)
        .query((params: any) => params['filter[appStoreState]'] !== AppStoreState.READY_FOR_SALE)
        .reply(200, require('./fixtures/apps/get-appStoreVersions-count-multiple-200.json'))
        // Respond to version.getLocalizationsAsync (for version 2.0)
        .get(`/v1/${AppStoreVersion.type}/APP_STORE_VERSION_2/${AppStoreVersionLocalization.type}`)
        .reply(
          200,
          require('./fixtures/appStoreVersions/get-appStoreVersionLocalizations-200.json')
        )
        // Respond to version.getPhasedReleaseAsync
        .get(`/v1/${AppStoreVersion.type}/APP_STORE_VERSION_2/appStoreVersionPhasedRelease`)
        .reply(200, {
          data: {
            id: 'APP_STORE_VERSION_PHASED_RELEASE_1',
            type: AppStoreVersionPhasedRelease.type,
            attributes: {
              phasedReleaseState: PhasedReleaseState.INACTIVE,
              currentDayNumber: null,
              startDate: null,
              totalPauseDuration: null,
            },
          },
        });

      const context: PartialAppleData = {
        app: new App(requestContext, 'stub-id', {} as any),
      };

      await new AppVersionTask({ version: '2.0' }).prepareAsync({ context });

      expect(context.version).toBeInstanceOf(AppStoreVersion);
      expect(context.version?.attributes).toHaveProperty('versionString', '2.0');
      expect(scope.isDone()).toBeTruthy();
    });

    it('creates the non-existing version from options', async () => {
      const scope = nock('https://api.appstoreconnect.apple.com')
        // Respond to app.getAppStoreVersionsAsync in findEditAppStoreVersionAsync
        .get(`/v1/${App.type}/stub-id/${AppStoreVersion.type}`)
        .query(true)
        .reply(200, require('./fixtures/apps/get-appStoreVersions-count-multiple-200.json'))
        // Respond to app.getAppStoreVersionsAsync in createOrUpdateEditAppStoreVersionAsync
        .get(`/v1/${App.type}/stub-id/${AppStoreVersion.type}`)
        .query(true)
        .reply(200, require('./fixtures/apps/get-appStoreVersions-200-empty.json'))
        // Respond to app.createVersionAsync in createOrUpdateEditAppStoreVersionAsync
        .post(`/v1/${AppStoreVersion.type}`)
        .reply(201, require('./fixtures/appStoreVersions/post-201.json'))
        // Respond to app.getAppStoreVersionsAsync
        .get(`/v1/${App.type}/stub-id/${AppStoreVersion.type}`)
        .query((params: any) => params['filter[appStoreState]'] !== AppStoreState.READY_FOR_SALE)
        .reply(200, require('./fixtures/apps/get-appStoreVersions-count-multiple-200.json'))
        // Respond to version.getLocalizationsAsync (for version 3.0)
        .get(`/v1/${AppStoreVersion.type}/APP_STORE_VERSION_3/${AppStoreVersionLocalization.type}`)
        .reply(
          200,
          require('./fixtures/appStoreVersions/get-appStoreVersionLocalizations-200.json')
        )
        // Respond to version.getPhasedReleaseAsync (for version 3.0)
        .get(`/v1/${AppStoreVersion.type}/APP_STORE_VERSION_3/appStoreVersionPhasedRelease`)
        .reply(200, {
          data: {
            id: 'APP_STORE_VERSION_PHASED_RELEASE_1',
            type: AppStoreVersionPhasedRelease.type,
            attributes: {
              phasedReleaseState: PhasedReleaseState.INACTIVE,
              currentDayNumber: null,
              startDate: null,
              totalPauseDuration: null,
            },
          },
        });

      const context: PartialAppleData = {
        app: new App(requestContext, 'stub-id', {} as any),
      };

      await new AppVersionTask({ version: '3.0' }).prepareAsync({ context });

      expect(context.version).toBeInstanceOf(AppStoreVersion);
      expect(context.version?.attributes).toHaveProperty('versionString', '3.0');
      expect(scope.isDone()).toBeTruthy();
    });
  });

  describe('downloadAsync', () => {
    it('aborts when version is not loaded', async () => {
      const promise = new AppVersionTask().downloadAsync({
        config: new AppleConfigWriter(),
        context: { version: undefined } as any,
      });

      await expect(promise).rejects.toThrow('not initialized');
    });

    it('sets version when loaded', async () => {
      const writer = new AppleConfigWriter();
      const version = new AppStoreVersion(requestContext, 'stub-id', {} as any);

      await new AppVersionTask().downloadAsync({
        config: writer,
        context: { version, versionLocales: [] } as any,
      });

      expect(writer.setVersion).toBeCalledWith(version.attributes);
    });

    it('sets version release type when loaded', async () => {
      const writer = new AppleConfigWriter();
      const version = new AppStoreVersion(requestContext, 'stub-id', {} as any);

      await new AppVersionTask().downloadAsync({
        config: writer,
        context: { version, versionLocales: [] } as any,
      });

      expect(writer.setVersionReleaseType).toBeCalledWith(version.attributes);
    });

    it('sets version phased release when loaded', async () => {
      const writer = new AppleConfigWriter();
      const version = new AppStoreVersion(requestContext, 'stub-id', {} as any);
      const versionPhasedRelease = new AppStoreVersionPhasedRelease(
        requestContext,
        'stub-id',
        {} as any
      );

      await new AppVersionTask().downloadAsync({
        config: writer,
        context: { version, versionPhasedRelease, versionLocales: [] } as any,
      });

      expect(writer.setVersionReleasePhased).toBeCalledWith(versionPhasedRelease.attributes);
    });

    it('skips when no locales are loaded', async () => {
      const writer = jest.mocked(new AppleConfigWriter());

      await new AppVersionTask().downloadAsync({
        config: writer,
        context: {
          version: new AppStoreVersion(requestContext, 'stub-id', {} as any),
          versionLocales: [],
        } as any,
      });

      expect(writer.setInfoLocale).not.toBeCalled();
    });

    it('sets locales when loaded', async () => {
      const writer = jest.mocked(new AppleConfigWriter());
      const versionLocales = [
        new AppStoreVersionLocalization(requestContext, 'stub-id-1', {} as any),
        new AppStoreVersionLocalization(requestContext, 'stub-id-2', {} as any),
      ];

      await new AppVersionTask().downloadAsync({
        config: writer,
        context: {
          version: new AppStoreVersion(requestContext, 'stub-id', {} as any),
          versionLocales,
        } as any,
      });

      expect(writer.setVersionLocale).toBeCalledWith(versionLocales[0].attributes);
      expect(writer.setVersionLocale).toBeCalledWith(versionLocales[1].attributes);
    });
  });

  describe('uploadAsync', () => {
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

      const attributes = { ...config.getVersion(), ...config.getVersionReleaseType() };
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

      const context: PartialAppleData = {
        app: new App(requestContext, 'stub-id', {} as any),
        version: new AppStoreVersion(requestContext, 'APP_STORE_VERSION_1', {} as any),
      };

      await new AppVersionTask().uploadAsync({ context: context as AppleData, config });

      expect(context.version?.attributes).toMatchObject(attributes);
      expect(scope.isDone()).toBeTruthy();
    });

    it('creates phased release when enabled in config', async () => {
      const config = new AppleConfigReader({ release: { phasedRelease: true } });
      const scope = nock('https://api.appstoreconnect.apple.com')
        .post(`/v1/${AppStoreVersionPhasedRelease.type}`)
        .reply(201, {
          data: {
            id: 'APP_STORE_VERSION_PHASED_RELEASE_1',
            type: AppStoreVersionPhasedRelease.type,
            attributes: {
              phasedReleaseState: PhasedReleaseState.ACTIVE,
              currentDayNumber: null,
              startDate: null,
              totalPauseDuration: null,
            },
          },
        });

      const context: PartialAppleData = {
        app: new App(requestContext, 'stub-id', {} as any),
        version: new AppStoreVersion(requestContext, 'APP_STORE_VERSION_1', {} as any),
        versionPhasedRelease: null, // Not enabled yet
      };

      await new AppVersionTask().uploadAsync({ context: context as AppleData, config });

      expect(context.versionPhasedRelease).toBeInstanceOf(AppStoreVersionPhasedRelease);
      expect(scope.isDone()).toBeTruthy();
    });

    it('deletes active phased release when disabled in config', async () => {
      const config = new AppleConfigReader({ release: { phasedRelease: false } });
      const scope = nock('https://api.appstoreconnect.apple.com')
        .delete(`/v1/${AppStoreVersionPhasedRelease.type}/APP_STORE_VERSION_PHASED_RELEASE_1`)
        .reply(204);

      const context: PartialAppleData = {
        app: new App(requestContext, 'stub-id', {} as any),
        version: new AppStoreVersion(requestContext, 'APP_STORE_VERSION_1', {} as any),
        // Enabled, and not completed yet
        versionPhasedRelease: new AppStoreVersionPhasedRelease(
          requestContext,
          'APP_STORE_VERSION_PHASED_RELEASE_1',
          { phasedReleaseState: PhasedReleaseState.ACTIVE } as any
        ),
      };

      await new AppVersionTask().uploadAsync({ context: context as AppleData, config });

      expect(context.versionPhasedRelease).toBeNull();
      expect(scope.isDone()).toBeTruthy();
    });

    it('does not delete completed phased release when disabled in config', async () => {
      const config = new AppleConfigReader({ release: { phasedRelease: false } });
      const scope = nock('https://api.appstoreconnect.apple.com')
        .delete(`/v1/${AppStoreVersionPhasedRelease.type}/APP_STORE_VERSION_PHASED_RELEASE_1`)
        .reply(204);

      const context: PartialAppleData = {
        app: new App(requestContext, 'stub-id', {} as any),
        version: new AppStoreVersion(requestContext, 'APP_STORE_VERSION_1', {} as any),
        // Enabled, and not completed yet
        versionPhasedRelease: new AppStoreVersionPhasedRelease(
          requestContext,
          'APP_STORE_VERSION_PHASED_RELEASE_1',
          { phasedReleaseState: PhasedReleaseState.COMPLETE } as any
        ),
      };

      await new AppVersionTask().uploadAsync({ context: context as AppleData, config });

      expect(context.versionPhasedRelease).toBe(context.versionPhasedRelease);
      expect(scope.isDone()).toBeFalsy();
      nock.cleanAll();
    });
  });
});
