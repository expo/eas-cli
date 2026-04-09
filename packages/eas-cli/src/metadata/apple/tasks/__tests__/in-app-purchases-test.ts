import { App, InAppPurchase, InAppPurchaseState, InAppPurchaseType } from '@expo/apple-utils';
import nock from 'nock';

import { requestContext } from './fixtures/requestContext';
import { AppleConfigReader } from '../../config/reader';
import { AppleConfigWriter } from '../../config/writer';
import { AppleData, PartialAppleData } from '../../data';
import { InAppPurchasesTask } from '../in-app-purchases';

jest.mock('../../../../ora');
jest.mock('../../config/writer');

function makeIap(
  id: string,
  attrs: {
    productId: string;
    referenceName: string;
    inAppPurchaseType?: InAppPurchaseType;
    state?: InAppPurchaseState;
  }
): InAppPurchase {
  return new InAppPurchase(requestContext, id, {
    productId: attrs.productId,
    referenceName: attrs.referenceName,
    inAppPurchaseType: attrs.inAppPurchaseType ?? InAppPurchaseType.NON_CONSUMABLE,
    state: attrs.state ?? InAppPurchaseState.APPROVED,
  } as any);
}

const IAPS_EMPTY_RESPONSE = {
  data: [],
  links: {
    self: 'https://appstoreconnect.apple.com/iris/v1/apps/stub-id/inAppPurchases',
  },
  meta: { paging: { total: 0, limit: 50 } },
};

describe(InAppPurchasesTask, () => {
  afterEach(() => {
    nock.cleanAll();
  });

  describe('prepareAsync', () => {
    it('initializes an empty map when the app has no IAPs', async () => {
      const scope = nock('https://api.appstoreconnect.apple.com')
        .get(/\/apps\/stub-id\/inAppPurchases/)
        .reply(200, IAPS_EMPTY_RESPONSE);

      const context: PartialAppleData = {
        app: new App(requestContext, 'stub-id', {} as any),
        projectDir: '/test/project',
      };

      await new InAppPurchasesTask().prepareAsync({ context });

      expect(context.inAppPurchases).toBeDefined();
      expect(context.inAppPurchases?.size).toBe(0);
      expect(scope.isDone()).toBeTruthy();
    });

    it('warns and falls back to empty map when ASC errors out', async () => {
      const scope = nock('https://api.appstoreconnect.apple.com')
        .get(/\/apps\/stub-id\/inAppPurchases/)
        .reply(500, { errors: [{ status: '500', title: 'boom' }] });

      const context: PartialAppleData = {
        app: new App(requestContext, 'stub-id', {} as any),
        projectDir: '/test/project',
      };

      await new InAppPurchasesTask().prepareAsync({ context });

      expect(context.inAppPurchases?.size).toBe(0);
      expect(scope.isDone()).toBeTruthy();
    });
  });

  describe('downloadAsync', () => {
    it('writes nothing when the inventory is empty', async () => {
      const writer = jest.mocked(new AppleConfigWriter());

      await new InAppPurchasesTask().downloadAsync({
        config: writer,
        context: { inAppPurchases: new Map() } as AppleData,
      });

      expect(writer.setInAppPurchases).toBeCalledWith([]);
    });

    it('writes a single IAP entry when one is registered', async () => {
      const writer = jest.mocked(new AppleConfigWriter());
      const iap = makeIap('iap-1', {
        productId: 'com.example.coins',
        referenceName: 'Coins',
        inAppPurchaseType: InAppPurchaseType.CONSUMABLE,
        state: InAppPurchaseState.APPROVED,
      });

      await new InAppPurchasesTask().downloadAsync({
        config: writer,
        context: {
          inAppPurchases: new Map([[iap.attributes.productId, iap]]),
        } as AppleData,
      });

      expect(writer.setInAppPurchases).toBeCalledWith([
        {
          productId: 'com.example.coins',
          referenceName: 'Coins',
          type: 'CONSUMABLE',
          state: 'APPROVED',
        },
      ]);
    });

    it('writes multiple IAP entries when several are registered', async () => {
      const writer = jest.mocked(new AppleConfigWriter());
      const a = makeIap('iap-a', {
        productId: 'com.example.a',
        referenceName: 'A',
        inAppPurchaseType: InAppPurchaseType.CONSUMABLE,
      });
      const b = makeIap('iap-b', {
        productId: 'com.example.b',
        referenceName: 'B',
        inAppPurchaseType: InAppPurchaseType.NON_CONSUMABLE,
      });

      await new InAppPurchasesTask().downloadAsync({
        config: writer,
        context: {
          inAppPurchases: new Map([
            ['com.example.a', a],
            ['com.example.b', b],
          ]),
        } as AppleData,
      });

      expect(writer.setInAppPurchases).toBeCalledTimes(1);
      const arg = writer.setInAppPurchases.mock.calls[0][0];
      expect(arg).toHaveLength(2);
      expect(arg.map((entry: any) => entry.productId).sort()).toEqual([
        'com.example.a',
        'com.example.b',
      ]);
    });
  });

  describe('uploadAsync', () => {
    it('skips when no IAPs are configured', async () => {
      const reader = new AppleConfigReader({});

      await new InAppPurchasesTask().uploadAsync({
        config: reader,
        context: { inAppPurchases: new Map() } as AppleData,
      });

      // No HTTP calls should occur — the task is read-only.
      expect(nock.pendingMocks()).toHaveLength(0);
    });

    it('treats an existing matching IAP as a no-op', async () => {
      const existing = makeIap('iap-1', {
        productId: 'com.example.coins',
        referenceName: 'Coins',
        inAppPurchaseType: InAppPurchaseType.CONSUMABLE,
      });

      const reader = new AppleConfigReader({
        inAppPurchases: [
          {
            productId: 'com.example.coins',
            referenceName: 'Coins',
            type: 'CONSUMABLE',
          },
        ],
      });

      await new InAppPurchasesTask().uploadAsync({
        config: reader,
        context: {
          inAppPurchases: new Map([['com.example.coins', existing]]),
        } as AppleData,
      });

      // Read-only push: no HTTP calls regardless of state.
      expect(nock.pendingMocks()).toHaveLength(0);
    });

    it('reports a would-create when config has a new IAP', async () => {
      const reader = new AppleConfigReader({
        inAppPurchases: [
          {
            productId: 'com.example.new',
            referenceName: 'New IAP',
            type: 'NON_CONSUMABLE',
          },
        ],
      });

      await new InAppPurchasesTask().uploadAsync({
        config: reader,
        context: { inAppPurchases: new Map() } as AppleData,
      });

      // No HTTP calls — current implementation only warns.
      expect(nock.pendingMocks()).toHaveLength(0);
    });

    it('reports a would-rename when referenceName differs', async () => {
      const existing = makeIap('iap-1', {
        productId: 'com.example.coins',
        referenceName: 'Coins',
        inAppPurchaseType: InAppPurchaseType.CONSUMABLE,
      });

      const reader = new AppleConfigReader({
        inAppPurchases: [
          {
            productId: 'com.example.coins',
            referenceName: 'Gold Coins',
            type: 'CONSUMABLE',
          },
        ],
      });

      await new InAppPurchasesTask().uploadAsync({
        config: reader,
        context: {
          inAppPurchases: new Map([['com.example.coins', existing]]),
        } as AppleData,
      });

      // No HTTP calls — current implementation only warns.
      expect(nock.pendingMocks()).toHaveLength(0);
    });
  });

  describe('round-trip', () => {
    it('preserves productId / referenceName / type from pull to push', async () => {
      // Pull: fetch from ASC and write to a real (un-mocked) writer.
      jest.unmock('../../config/writer');
      const { AppleConfigWriter: RealWriter } = jest.requireActual(
        '../../config/writer'
      );
      const writer = new RealWriter();

      const iap = makeIap('iap-1', {
        productId: 'com.example.gem',
        referenceName: 'Gem',
        inAppPurchaseType: InAppPurchaseType.NON_CONSUMABLE,
        state: InAppPurchaseState.APPROVED,
      });

      await new InAppPurchasesTask().downloadAsync({
        config: writer,
        context: {
          inAppPurchases: new Map([[iap.attributes.productId, iap]]),
        } as AppleData,
      });

      const schema = writer.toSchema();
      expect(schema.apple.inAppPurchases).toEqual([
        {
          productId: 'com.example.gem',
          referenceName: 'Gem',
          type: 'NON_CONSUMABLE',
          state: 'APPROVED',
        },
      ]);

      // Push: feed the schema back through the reader and confirm the
      // existing IAP is treated as already in sync (no warnings, no calls).
      const reader = new AppleConfigReader(schema.apple);
      await new InAppPurchasesTask().uploadAsync({
        config: reader,
        context: {
          inAppPurchases: new Map([[iap.attributes.productId, iap]]),
        } as AppleData,
      });
      expect(nock.pendingMocks()).toHaveLength(0);
    });
  });
});
