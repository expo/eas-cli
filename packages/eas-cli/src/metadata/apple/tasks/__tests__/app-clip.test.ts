import {
  App,
  AppClip,
  AppClipAppStoreReviewDetail,
  AppClipDefaultExperience,
  AppClipDefaultExperienceLocalization,
  AppStoreVersion,
} from '@expo/apple-utils';
import nock from 'nock';

import { requestContext } from './fixtures/requestContext';
import { AppleConfigReader } from '../../config/reader';
import { AppleConfigWriter } from '../../config/writer';
import { AppleData, PartialAppleData } from '../../data';
import { AppClipTask } from '../app-clip';

jest.mock('../../../../ora');
jest.mock('../../config/writer');

function makeExperience(
  id: string,
  attrs: Partial<AppClipDefaultExperience['attributes']> = {}
): AppClipDefaultExperience {
  return new AppClipDefaultExperience(requestContext, id, {
    action: null,
    ...attrs,
  } as any);
}

function makeLocalization(
  id: string,
  locale: string,
  subtitle: string | null = null
): AppClipDefaultExperienceLocalization {
  return new AppClipDefaultExperienceLocalization(requestContext, id, {
    locale,
    subtitle,
  } as any);
}

function makeVersion(id: string): AppStoreVersion {
  return new AppStoreVersion(requestContext, id, { versionString: '1.0.0' } as any);
}

const APP_CLIPS_EMPTY_RESPONSE = {
  data: [],
  links: { self: 'https://api.appstoreconnect.apple.com/v1/apps/stub-id/appClips' },
  meta: { paging: { total: 0, limit: 50 } },
};

describe(AppClipTask, () => {
  describe('prepareAsync', () => {
    it('initializes empty state when the app has no app clips', async () => {
      const scope = nock('https://api.appstoreconnect.apple.com')
        .get(uri => uri.startsWith(`/v1/${App.type}/stub-id/${AppClip.type}`))
        .reply(200, APP_CLIPS_EMPTY_RESPONSE);

      const context: PartialAppleData = {
        app: new App(requestContext, 'stub-id', {} as any),
        projectDir: '/test/project',
      };

      await new AppClipTask().prepareAsync({ context });

      expect(context.appClip).toBeNull();
      expect(context.appClipDefaultExperience).toBeNull();
      expect(context.appClipLocalizations?.size).toBe(0);
      expect(context.appClipHeaderImages?.size).toBe(0);
      expect(context.appClipReviewDetail).toBeNull();
      expect(scope.isDone()).toBeTruthy();
    });
  });

  describe('downloadAsync', () => {
    it('skips when no default experience is loaded', async () => {
      const writer = jest.mocked(new AppleConfigWriter());

      await new AppClipTask().downloadAsync({
        config: writer,
        context: {
          appClip: null,
          appClipDefaultExperience: null,
          appClipTemplateExperience: null,
          appClipLocalizations: new Map(),
          appClipHeaderImages: new Map(),
          appClipReviewDetail: null,
        } as any,
      });

      expect(writer.setAppClipDefaultExperience).not.toBeCalled();
      expect(writer.setAppClipLocalizedInfo).not.toBeCalled();
      expect(writer.setAppClipReviewDetail).not.toBeCalled();
    });

    it('writes from current version experience when present', async () => {
      const writer = jest.mocked(new AppleConfigWriter());
      const experience = makeExperience('exp-current', { action: 'PLAY' as any });
      const localization = makeLocalization('loc-1', 'en-US', 'Quick play');

      await new AppClipTask().downloadAsync({
        config: writer,
        context: {
          appClip: new AppClip(requestContext, 'clip-1', { bundleId: 'com.x.Clip' }),
          appClipDefaultExperience: experience,
          appClipTemplateExperience: null,
          appClipLocalizations: new Map([['en-US', localization]]),
          appClipHeaderImages: new Map(),
          appClipReviewDetail: null,
          projectDir: '/test/project',
        } as any,
      });

      expect(writer.setAppClipDefaultExperience).toBeCalledWith(
        expect.objectContaining({ action: 'PLAY' })
      );
      expect(writer.setAppClipLocalizedInfo).toBeCalledWith(
        'en-US',
        expect.objectContaining({ subtitle: 'Quick play' })
      );
    });

    it('falls back to template experience when current version has none', async () => {
      // Regression test: when bumping the app version, the new version has no
      // default experience yet. Pull should still populate config from the
      // most recent prior experience (the template) so the user has data to
      // edit, instead of writing nothing.
      const writer = jest.mocked(new AppleConfigWriter());
      const template = makeExperience('exp-template', { action: 'OPEN' as any });
      const localization = makeLocalization('loc-1', 'en-US', 'Old subtitle');

      await new AppClipTask().downloadAsync({
        config: writer,
        context: {
          appClip: new AppClip(requestContext, 'clip-1', { bundleId: 'com.x.Clip' }),
          appClipDefaultExperience: null,
          appClipTemplateExperience: template,
          appClipLocalizations: new Map([['en-US', localization]]),
          appClipHeaderImages: new Map(),
          appClipReviewDetail: null,
          projectDir: '/test/project',
        } as any,
      });

      expect(writer.setAppClipDefaultExperience).toBeCalledWith(
        expect.objectContaining({ action: 'OPEN' })
      );
      expect(writer.setAppClipLocalizedInfo).toBeCalledWith(
        'en-US',
        expect.objectContaining({ subtitle: 'Old subtitle' })
      );
    });

    it('preserves expected local path when header image is not yet downloadable', async () => {
      // Regression test for the App Clip header image race condition: ASC
      // hasn't yet rendered the imageAsset (typically right after a fresh
      // upload), so the download URL is null. We should still preserve the
      // headerImage path in config so subsequent pushes don't try to delete
      // the in-progress upload.
      const writer = jest.mocked(new AppleConfigWriter());
      const experience = makeExperience('exp-1', { action: 'OPEN' as any });
      const localization = makeLocalization('loc-1', 'en-US', 'Sub');
      // Header image with no rendered imageAsset (still processing).
      const headerImage = {
        attributes: { fileName: 'header.png', imageAsset: null },
        getImageAssetUrl: () => null,
      } as any;

      await new AppClipTask().downloadAsync({
        config: writer,
        context: {
          appClip: new AppClip(requestContext, 'clip-1', { bundleId: 'com.x.Clip' }),
          appClipDefaultExperience: experience,
          appClipTemplateExperience: null,
          appClipLocalizations: new Map([['en-US', localization]]),
          appClipHeaderImages: new Map([['en-US', headerImage]]),
          appClipReviewDetail: null,
          projectDir: '/test/project',
        } as any,
      });

      expect(writer.setAppClipLocalizedInfo).toBeCalledWith(
        'en-US',
        expect.objectContaining({
          subtitle: 'Sub',
          headerImage: 'store/apple/app-clip/en-US/header.png',
        })
      );
    });
  });

  describe('uploadAsync', () => {
    it('skips when no app clip is configured in store config', async () => {
      const reader = new AppleConfigReader({});

      await new AppClipTask().uploadAsync({
        config: reader,
        context: {
          appClip: null,
          appClipDefaultExperience: null,
          appClipTemplateExperience: null,
          appClipLocalizations: new Map(),
          appClipHeaderImages: new Map(),
          appClipReviewDetail: null,
        } as AppleData,
      });

      // No HTTP calls should be made when nothing is configured.
      expect(nock.pendingMocks()).toHaveLength(0);
    });

    it('warns and aborts when ASC has no app clip but config does', async () => {
      const reader = new AppleConfigReader({
        appClip: {
          defaultExperience: { action: 'OPEN' },
        },
      });

      await new AppClipTask().uploadAsync({
        config: reader,
        context: {
          appClip: null,
          appClipDefaultExperience: null,
          appClipTemplateExperience: null,
          appClipLocalizations: new Map(),
          appClipHeaderImages: new Map(),
          appClipReviewDetail: null,
        } as AppleData,
      });

      // No HTTP calls when there's no clip in ASC to update.
      expect(nock.pendingMocks()).toHaveLength(0);
    });

    it('warns and aborts when no editable app store version is loaded', async () => {
      const reader = new AppleConfigReader({
        appClip: { defaultExperience: { action: 'OPEN' } },
      });

      await new AppClipTask().uploadAsync({
        config: reader,
        context: {
          appClip: new AppClip(requestContext, 'clip-1', { bundleId: 'com.x.Clip' }),
          version: null,
          appClipDefaultExperience: null,
          appClipTemplateExperience: null,
          appClipLocalizations: new Map(),
          appClipHeaderImages: new Map(),
          appClipReviewDetail: null,
        } as any,
      });

      expect(nock.pendingMocks()).toHaveLength(0);
    });

    it('skips PATCH when default experience action already matches config', async () => {
      // Regression test: Apple rejects PATCHes on `action` once the linked
      // version is locked (in review/released), so we must skip the call when
      // nothing changed to avoid spurious failures on round-trip pushes.
      const reader = new AppleConfigReader({
        appClip: { defaultExperience: { action: 'PLAY' } },
      });
      const existing = makeExperience('exp-current', { action: 'PLAY' as any });
      // Spy on updateAsync to assert it's not invoked.
      const updateSpy = jest.spyOn(existing, 'updateAsync');

      await new AppClipTask().uploadAsync({
        config: reader,
        context: {
          app: new App(requestContext, 'app-1', {} as any),
          appClip: new AppClip(requestContext, 'clip-1', { bundleId: 'com.x.Clip' }),
          version: makeVersion('ver-1'),
          appClipDefaultExperience: existing,
          appClipTemplateExperience: null,
          appClipLocalizations: new Map(),
          appClipHeaderImages: new Map(),
          appClipReviewDetail: null,
        } as any,
      });

      expect(updateSpy).not.toBeCalled();
    });

    it('skips review detail PATCH when invocation URLs already match', async () => {
      const reader = new AppleConfigReader({
        appClip: {
          defaultExperience: {
            action: 'OPEN',
            reviewDetail: { invocationUrls: ['https://a.example/', 'https://b.example/'] },
          },
        },
      });
      const existing = makeExperience('exp-current', { action: 'OPEN' as any });
      const review = new AppClipAppStoreReviewDetail(requestContext, 'rev-1', {
        invocationUrls: ['https://a.example/', 'https://b.example/'],
      } as any);
      const updateSpy = jest.spyOn(review, 'updateAsync');

      await new AppClipTask().uploadAsync({
        config: reader,
        context: {
          app: new App(requestContext, 'app-1', {} as any),
          appClip: new AppClip(requestContext, 'clip-1', { bundleId: 'com.x.Clip' }),
          version: makeVersion('ver-1'),
          appClipDefaultExperience: existing,
          appClipTemplateExperience: null,
          appClipLocalizations: new Map(),
          appClipHeaderImages: new Map(),
          appClipReviewDetail: review,
        } as any,
      });

      expect(updateSpy).not.toBeCalled();
    });
  });
});
