import {
  App,
  AppDataUsage,
  AppDataUsageCategoryId,
  AppDataUsageDataProtectionId,
  AppDataUsagePurposeId,
  AppDataUsagesPublishState,
} from '@expo/apple-utils';

import { requestContext } from './fixtures/requestContext';
import { AppleConfigReader } from '../../config/reader';
import { AppleConfigWriter } from '../../config/writer';
import { AppleData } from '../../data';
import { DataUsageTask } from '../data-usage';

jest.mock('../../../../ora');
jest.mock('../../config/writer');

function makeRow(
  id: string,
  category: AppDataUsageCategoryId | null,
  purpose: AppDataUsagePurposeId | null,
  protection: AppDataUsageDataProtectionId | null
): AppDataUsage {
  const row = new AppDataUsage(requestContext, id, {
    category: category ? ({ id: category } as any) : undefined,
    purpose: purpose ? ({ id: purpose } as any) : undefined,
    dataProtection: protection ? ({ id: protection } as any) : undefined,
  } as any);
  // Stub deleteAsync so the diff path doesn't actually hit the network.
  (row as any).deleteAsync = jest.fn().mockResolvedValue(undefined);
  return row;
}

function makeApp(): App {
  const app = new App(requestContext, 'app-id', {} as any);
  (app as any).getAppDataUsagesAsync = jest.fn().mockResolvedValue([]);
  (app as any).getAppDataUsagesPublishStateAsync = jest.fn().mockResolvedValue([]);
  (app as any).createAppDataUsageAsync = jest.fn(async (params: any) => {
    return makeRow(
      `created-${params.appDataUsageCategory ?? 'none'}-${params.appDataUsagePurpose ?? 'none'}-${
        params.appDataUsageProtection ?? 'none'
      }`,
      params.appDataUsageCategory ?? null,
      params.appDataUsagePurpose ?? null,
      params.appDataUsageProtection ?? null
    );
  });
  return app;
}

function makePublishState(): AppDataUsagesPublishState {
  const state = new AppDataUsagesPublishState(requestContext, 'app-id', {
    published: false,
    lastPublished: '',
    lastPublishedBy: '',
  } as any);
  (state as any).updateAsync = jest.fn().mockResolvedValue(state);
  return state;
}

describe(DataUsageTask, () => {
  describe('prepareAsync', () => {
    it('loads existing data usage rows and publish state', async () => {
      const app = makeApp();
      const existing = [
        makeRow(
          'row-1',
          AppDataUsageCategoryId.CONTACTS,
          AppDataUsagePurposeId.ANALYTICS,
          AppDataUsageDataProtectionId.DATA_LINKED_TO_YOU
        ),
      ];
      (app as any).getAppDataUsagesAsync.mockResolvedValue(existing);
      const publishState = makePublishState();
      (app as any).getAppDataUsagesPublishStateAsync.mockResolvedValue([publishState]);

      const context: any = { app, projectDir: '/p' };
      await new DataUsageTask().prepareAsync({ context });

      expect(context.dataUsages).toBe(existing);
      expect(context.dataUsagesPublishState).toBe(publishState);
    });

    it('treats 404s as empty state', async () => {
      const app = makeApp();
      (app as any).getAppDataUsagesAsync.mockRejectedValue({ response: { status: 404 } });
      (app as any).getAppDataUsagesPublishStateAsync.mockRejectedValue({
        response: { status: 404 },
      });

      const context: any = { app, projectDir: '/p' };
      await new DataUsageTask().prepareAsync({ context });

      expect(context.dataUsages).toEqual([]);
      expect(context.dataUsagesPublishState).toBeNull();
    });
  });

  describe('downloadAsync', () => {
    it('writes nothing when there are no rows', async () => {
      const writer = jest.mocked(new AppleConfigWriter());

      await new DataUsageTask().downloadAsync({
        config: writer,
        context: { dataUsages: [], dataUsagesPublishState: null } as any,
      });

      expect(writer.setDataUsage).toHaveBeenCalledWith(null);
    });

    it('collapses a single row into a category entry', async () => {
      const writer = jest.mocked(new AppleConfigWriter());

      await new DataUsageTask().downloadAsync({
        config: writer,
        context: {
          dataUsages: [
            makeRow(
              'row-1',
              AppDataUsageCategoryId.CONTACTS,
              AppDataUsagePurposeId.ANALYTICS,
              AppDataUsageDataProtectionId.DATA_LINKED_TO_YOU
            ),
          ],
          dataUsagesPublishState: null,
        } as any,
      });

      expect(writer.setDataUsage).toHaveBeenCalledWith({
        categories: [
          {
            category: 'CONTACTS',
            purposes: ['ANALYTICS'],
            protections: ['DATA_LINKED_TO_YOU'],
          },
        ],
      });
    });

    it('groups multiple rows by category and dedupes purposes/protections', async () => {
      const writer = jest.mocked(new AppleConfigWriter());

      await new DataUsageTask().downloadAsync({
        config: writer,
        context: {
          dataUsages: [
            makeRow(
              'r1',
              AppDataUsageCategoryId.CONTACTS,
              AppDataUsagePurposeId.ANALYTICS,
              AppDataUsageDataProtectionId.DATA_LINKED_TO_YOU
            ),
            makeRow(
              'r2',
              AppDataUsageCategoryId.CONTACTS,
              AppDataUsagePurposeId.APP_FUNCTIONALITY,
              AppDataUsageDataProtectionId.DATA_LINKED_TO_YOU
            ),
            makeRow(
              'r3',
              AppDataUsageCategoryId.PRECISE_LOCATION,
              AppDataUsagePurposeId.APP_FUNCTIONALITY,
              AppDataUsageDataProtectionId.DATA_NOT_LINKED_TO_YOU
            ),
          ],
          dataUsagesPublishState: null,
        } as any,
      });

      const arg = (writer.setDataUsage as jest.Mock).mock.calls[0][0];
      expect(arg.categories).toHaveLength(2);
      const contacts = arg.categories.find((c: any) => c.category === 'CONTACTS');
      expect(contacts.purposes.sort()).toEqual(['ANALYTICS', 'APP_FUNCTIONALITY']);
      expect(contacts.protections).toEqual(['DATA_LINKED_TO_YOU']);
      const location = arg.categories.find((c: any) => c.category === 'PRECISE_LOCATION');
      expect(location.purposes).toEqual(['APP_FUNCTIONALITY']);
      expect(location.protections).toEqual(['DATA_NOT_LINKED_TO_YOU']);
    });

    it('emits dataNotCollected when only the sentinel row is present', async () => {
      const writer = jest.mocked(new AppleConfigWriter());

      await new DataUsageTask().downloadAsync({
        config: writer,
        context: {
          dataUsages: [makeRow('r1', null, null, AppDataUsageDataProtectionId.DATA_NOT_COLLECTED)],
          dataUsagesPublishState: null,
        } as any,
      });

      expect(writer.setDataUsage).toHaveBeenCalledWith({ dataNotCollected: true });
    });
  });

  describe('uploadAsync', () => {
    it('skips when no data usage is configured', async () => {
      const app = makeApp();
      const ctx: AppleData = {
        app,
        projectDir: '/p',
        dataUsages: [],
        dataUsagesPublishState: null,
      } as any;

      await new DataUsageTask().uploadAsync({
        config: new AppleConfigReader({}),
        context: ctx,
      });

      expect((app as any).createAppDataUsageAsync).not.toHaveBeenCalled();
    });

    it('creates rows for each (category × purpose × protection) tuple', async () => {
      const app = makeApp();
      const publishState = makePublishState();
      const ctx: AppleData = {
        app,
        projectDir: '/p',
        dataUsages: [],
        dataUsagesPublishState: publishState,
      } as any;

      await new DataUsageTask().uploadAsync({
        config: new AppleConfigReader({
          privacy: {
            dataUsage: {
              categories: [
                {
                  category: 'CONTACTS',
                  purposes: ['ANALYTICS', 'APP_FUNCTIONALITY'],
                  protections: ['DATA_LINKED_TO_YOU'],
                },
              ],
            },
          },
        }),
        context: ctx,
      });

      expect((app as any).createAppDataUsageAsync).toHaveBeenCalledTimes(2);
      expect((publishState as any).updateAsync).toHaveBeenCalledWith({ published: true });
    });

    it('deletes rows that are no longer in the config and creates new ones', async () => {
      const app = makeApp();
      const publishState = makePublishState();
      const stale = makeRow(
        'stale',
        AppDataUsageCategoryId.PRECISE_LOCATION,
        AppDataUsagePurposeId.OTHER_PURPOSES,
        AppDataUsageDataProtectionId.DATA_LINKED_TO_YOU
      );
      const kept = makeRow(
        'kept',
        AppDataUsageCategoryId.CONTACTS,
        AppDataUsagePurposeId.ANALYTICS,
        AppDataUsageDataProtectionId.DATA_LINKED_TO_YOU
      );
      (app as any).getAppDataUsagesAsync.mockResolvedValue([stale, kept]);

      const ctx: AppleData = {
        app,
        projectDir: '/p',
        dataUsages: [stale, kept],
        dataUsagesPublishState: publishState,
      } as any;

      await new DataUsageTask().uploadAsync({
        config: new AppleConfigReader({
          privacy: {
            dataUsage: {
              categories: [
                {
                  category: 'CONTACTS',
                  purposes: ['ANALYTICS'],
                  protections: ['DATA_LINKED_TO_YOU'],
                },
                {
                  category: 'EMAIL_ADDRESS',
                  purposes: ['APP_FUNCTIONALITY'],
                  protections: ['DATA_LINKED_TO_YOU'],
                },
              ],
            },
          },
        }),
        context: ctx,
      });

      // stale row deleted, EMAIL_ADDRESS row created, CONTACTS untouched.
      expect((stale as any).deleteAsync).toHaveBeenCalled();
      expect((kept as any).deleteAsync).not.toHaveBeenCalled();
      expect((app as any).createAppDataUsageAsync).toHaveBeenCalledTimes(1);
      expect((app as any).createAppDataUsageAsync).toHaveBeenCalledWith({
        appDataUsageCategory: 'EMAIL_ADDRESS',
        appDataUsagePurpose: 'APP_FUNCTIONALITY',
        appDataUsageProtection: 'DATA_LINKED_TO_YOU',
      });
      expect((publishState as any).updateAsync).toHaveBeenCalledWith({ published: true });
    });

    it('makes no API calls when the config matches existing rows exactly', async () => {
      const app = makeApp();
      const publishState = makePublishState();
      const existing = makeRow(
        'r1',
        AppDataUsageCategoryId.CONTACTS,
        AppDataUsagePurposeId.ANALYTICS,
        AppDataUsageDataProtectionId.DATA_LINKED_TO_YOU
      );
      const ctx: AppleData = {
        app,
        projectDir: '/p',
        dataUsages: [existing],
        dataUsagesPublishState: publishState,
      } as any;

      await new DataUsageTask().uploadAsync({
        config: new AppleConfigReader({
          privacy: {
            dataUsage: {
              categories: [
                {
                  category: 'CONTACTS',
                  purposes: ['ANALYTICS'],
                  protections: ['DATA_LINKED_TO_YOU'],
                },
              ],
            },
          },
        }),
        context: ctx,
      });

      expect((existing as any).deleteAsync).not.toHaveBeenCalled();
      expect((app as any).createAppDataUsageAsync).not.toHaveBeenCalled();
      // Publish state is still flipped to ensure published.
      expect((publishState as any).updateAsync).toHaveBeenCalledWith({ published: true });
    });
  });

  describe('round-trip', () => {
    it('downloads then uploads without making mutation calls', async () => {
      // Use the real writer (not the auto-mock) so we can read back the
      // serialized schema and feed it into the upload path.
      const RealWriter = jest.requireActual('../../config/writer')
        .AppleConfigWriter as typeof AppleConfigWriter;
      // Pull side: collapse rows into config.
      const writer = new RealWriter();
      const downloadApp = makeApp();
      const rows = [
        makeRow(
          'r1',
          AppDataUsageCategoryId.CONTACTS,
          AppDataUsagePurposeId.ANALYTICS,
          AppDataUsageDataProtectionId.DATA_LINKED_TO_YOU
        ),
        makeRow(
          'r2',
          AppDataUsageCategoryId.CONTACTS,
          AppDataUsagePurposeId.APP_FUNCTIONALITY,
          AppDataUsageDataProtectionId.DATA_LINKED_TO_YOU
        ),
      ];
      await new DataUsageTask().downloadAsync({
        config: writer,
        context: { app: downloadApp, dataUsages: rows, dataUsagesPublishState: null } as any,
      });

      // The serialized config should now contain the rows.
      expect(writer.schema.privacy?.dataUsage).toEqual({
        categories: [
          {
            category: 'CONTACTS',
            purposes: ['ANALYTICS', 'APP_FUNCTIONALITY'],
            protections: ['DATA_LINKED_TO_YOU'],
          },
        ],
      });

      // Push side: feed the config back through the reader and verify nothing
      // is mutated since the existing rows already match.
      const uploadApp = makeApp();
      const publishState = makePublishState();
      const reader = new AppleConfigReader(writer.schema);
      await new DataUsageTask().uploadAsync({
        config: reader,
        context: {
          app: uploadApp,
          projectDir: '/p',
          dataUsages: rows,
          dataUsagesPublishState: publishState,
        } as any,
      });

      expect((uploadApp as any).createAppDataUsageAsync).not.toHaveBeenCalled();
      for (const row of rows) {
        expect((row as any).deleteAsync).not.toHaveBeenCalled();
      }
    });
  });
});
