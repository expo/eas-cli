import { App, AppClip } from '@expo/apple-utils';
import nock from 'nock';

import { requestContext } from './fixtures/requestContext';
import { AppleConfigReader } from '../../config/reader';
import { AppleConfigWriter } from '../../config/writer';
import { AppleData, PartialAppleData } from '../../data';
import { AppClipTask } from '../app-clip';

jest.mock('../../../../ora');
jest.mock('../../config/writer');

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
  });
});
