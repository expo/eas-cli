import { App, AppPrice, AppPriceTier, Territory } from '@expo/apple-utils';

import { requestContext } from './fixtures/requestContext';
import { AppleConfigReader } from '../../config/reader';
import { AppleConfigWriter } from '../../config/writer';
import { PartialAppleData } from '../../data';
import { PricingTask } from '../pricing';

jest.mock('../../../../ora');
jest.mock('../../config/writer');

function makePrice(id: string, startDate: string, tierId: string): AppPrice {
  const tier = new AppPriceTier(requestContext, tierId, {});
  return new AppPrice(requestContext, id, {
    startDate,
    priceTier: tier,
  } as any);
}

function makeTerritory(code: string, currency = 'USD'): Territory {
  return new Territory(requestContext, code, { currency });
}

function makeApp(id = 'stub-id'): App {
  return new App(requestContext, id, {} as any);
}

describe(PricingTask, () => {
  describe('prepareAsync', () => {
    it('populates appPrices and availableTerritories from App.infoAsync', async () => {
      const app = makeApp();
      const fetched = new App(requestContext, 'stub-id', {
        prices: [makePrice('p1', '2024-01-01T00:00:00Z', '0')],
        availableTerritories: [makeTerritory('USA'), makeTerritory('GBR', 'GBP')],
      } as any);
      const spy = jest.spyOn(App, 'infoAsync').mockResolvedValue(fetched);

      const context: PartialAppleData = { app, projectDir: '/test' };
      await new PricingTask().prepareAsync({ context });

      expect(spy).toHaveBeenCalledWith(
        app.context,
        expect.objectContaining({
          id: 'stub-id',
          query: expect.objectContaining({
            includes: expect.arrayContaining(['prices', 'availableTerritories']),
          }),
        })
      );
      expect(context.appPrices).toHaveLength(1);
      expect(context.availableTerritories).toHaveLength(2);
      spy.mockRestore();
    });

    it('initializes empty arrays when the API call fails', async () => {
      const spy = jest
        .spyOn(App, 'infoAsync')
        .mockRejectedValue(new Error('legacy pricing endpoint not available'));

      const context: PartialAppleData = { app: makeApp(), projectDir: '/test' };
      await new PricingTask().prepareAsync({ context });

      expect(context.appPrices).toEqual([]);
      expect(context.availableTerritories).toEqual([]);
      spy.mockRestore();
    });
  });

  describe('downloadAsync', () => {
    it('clears pricing and availability when the app has neither', async () => {
      const writer = jest.mocked(new AppleConfigWriter());

      await new PricingTask().downloadAsync({
        config: writer,
        context: { appPrices: [], availableTerritories: [] } as any,
      });

      expect(writer.setPricing).toHaveBeenCalledWith(null);
      expect(writer.setAvailability).toHaveBeenCalledWith(null);
    });

    it('writes the current price tier (free)', async () => {
      const writer = jest.mocked(new AppleConfigWriter());

      await new PricingTask().downloadAsync({
        config: writer,
        context: {
          appPrices: [makePrice('p1', '2020-01-01T00:00:00Z', '0')],
          availableTerritories: [],
        } as any,
      });

      expect(writer.setPricing).toHaveBeenCalledWith(
        expect.objectContaining({ tier: '0', schedule: undefined })
      );
    });

    it('writes future price changes as schedule entries', async () => {
      const writer = jest.mocked(new AppleConfigWriter());
      const future = new Date(Date.now() + 1000 * 60 * 60 * 24 * 30).toISOString();

      await new PricingTask().downloadAsync({
        config: writer,
        context: {
          appPrices: [makePrice('p1', '2020-01-01T00:00:00Z', '0'), makePrice('p2', future, '5')],
          availableTerritories: [],
        } as any,
      });

      expect(writer.setPricing).toHaveBeenCalledWith(
        expect.objectContaining({
          tier: '0',
          schedule: [{ startDate: future, tier: '5' }],
        })
      );
    });

    it('writes territory codes', async () => {
      const writer = jest.mocked(new AppleConfigWriter());

      await new PricingTask().downloadAsync({
        config: writer,
        context: {
          appPrices: [],
          availableTerritories: [makeTerritory('USA'), makeTerritory('GBR', 'GBP')],
        } as any,
      });

      expect(writer.setAvailability).toHaveBeenCalledWith({ territories: ['USA', 'GBR'] });
    });
  });

  describe('uploadAsync', () => {
    it('skips when neither pricing nor availability is configured', async () => {
      const app = makeApp();
      const updateSpy = jest.spyOn(app, 'updateAsync').mockResolvedValue(app);

      await new PricingTask().uploadAsync({
        config: new AppleConfigReader({}),
        context: { app, appPrices: [], availableTerritories: [] } as any,
      });

      expect(updateSpy).not.toHaveBeenCalled();
    });

    it('pushes the configured price tier', async () => {
      const app = makeApp();
      const updateSpy = jest.spyOn(app, 'updateAsync').mockResolvedValue(app);

      await new PricingTask().uploadAsync({
        config: new AppleConfigReader({ pricing: { tier: '0' } }),
        context: { app, appPrices: [], availableTerritories: [] } as any,
      });

      expect(updateSpy).toHaveBeenCalledWith({
        appPriceTier: '0',
        territories: undefined,
      });
    });

    it('pushes a paid price tier', async () => {
      const app = makeApp();
      const updateSpy = jest.spyOn(app, 'updateAsync').mockResolvedValue(app);

      await new PricingTask().uploadAsync({
        config: new AppleConfigReader({ pricing: { tier: '5' } }),
        context: { app, appPrices: [], availableTerritories: [] } as any,
      });

      expect(updateSpy).toHaveBeenCalledWith({ appPriceTier: '5', territories: undefined });
    });

    it('warns and skips push for scheduled price changes', async () => {
      const app = makeApp();
      const updateSpy = jest.spyOn(app, 'updateAsync').mockResolvedValue(app);

      await new PricingTask().uploadAsync({
        config: new AppleConfigReader({
          pricing: {
            tier: '0',
            schedule: [{ startDate: '2099-01-01T00:00:00Z', tier: '5' }],
          },
        }),
        context: { app, appPrices: [], availableTerritories: [] } as any,
      });

      // Tier still gets pushed; schedule is logged as a warning.
      expect(updateSpy).toHaveBeenCalledWith({ appPriceTier: '0', territories: undefined });
    });

    it('pushes a single-territory availability list', async () => {
      const app = makeApp();
      const updateSpy = jest.spyOn(app, 'updateAsync').mockResolvedValue(app);

      await new PricingTask().uploadAsync({
        config: new AppleConfigReader({ availability: { territories: ['USA'] } }),
        context: { app, appPrices: [], availableTerritories: [] } as any,
      });

      expect(updateSpy).toHaveBeenCalledWith({
        appPriceTier: undefined,
        territories: ['USA'],
      });
    });

    it('pushes multiple territories, normalized and deduplicated', async () => {
      const app = makeApp();
      const updateSpy = jest.spyOn(app, 'updateAsync').mockResolvedValue(app);

      await new PricingTask().uploadAsync({
        config: new AppleConfigReader({
          availability: { territories: ['usa', 'GBR', 'usa', 'JPN'] },
        }),
        context: { app, appPrices: [], availableTerritories: [] } as any,
      });

      expect(updateSpy).toHaveBeenCalledWith({
        appPriceTier: undefined,
        territories: ['USA', 'GBR', 'JPN'],
      });
    });

    it('expands `all` to every supported territory', async () => {
      const app = makeApp();
      const updateSpy = jest.spyOn(app, 'updateAsync').mockResolvedValue(app);
      const territorySpy = jest
        .spyOn(Territory, 'getAsync')
        .mockResolvedValue([
          makeTerritory('USA'),
          makeTerritory('GBR', 'GBP'),
          makeTerritory('JPN', 'JPY'),
        ]);

      await new PricingTask().uploadAsync({
        config: new AppleConfigReader({ availability: { territories: 'all' } }),
        context: { app, appPrices: [], availableTerritories: [] } as any,
      });

      expect(territorySpy).toHaveBeenCalled();
      expect(updateSpy).toHaveBeenCalledWith({
        appPriceTier: undefined,
        territories: ['USA', 'GBR', 'JPN'],
      });
      territorySpy.mockRestore();
    });

    it('combines pricing and availability into a single update call', async () => {
      const app = makeApp();
      const updateSpy = jest.spyOn(app, 'updateAsync').mockResolvedValue(app);

      await new PricingTask().uploadAsync({
        config: new AppleConfigReader({
          pricing: { tier: '0' },
          availability: { territories: ['USA', 'GBR'] },
        }),
        context: { app, appPrices: [], availableTerritories: [] } as any,
      });

      expect(updateSpy).toHaveBeenCalledTimes(1);
      expect(updateSpy).toHaveBeenCalledWith({
        appPriceTier: '0',
        territories: ['USA', 'GBR'],
      });
    });
  });
});
