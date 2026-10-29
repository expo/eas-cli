import { AppObserveSpanKind, AppObserveSpanStatusCode } from '../../graphql/generated';
import {
  allowedSpanKindFlagValues,
  allowedSpanStatusFlagValues,
  spanKindsFromFlag,
  spanStatusCodesFromFlag,
} from '../spanFilters';

describe('span filter flags', () => {
  it('offers the lowercase enum values as flag options', () => {
    expect(allowedSpanKindFlagValues).toEqual(
      expect.arrayContaining([
        'client',
        'server',
        'internal',
        'producer',
        'consumer',
        'unspecified',
      ])
    );
    expect(allowedSpanStatusFlagValues).toEqual(['error', 'ok', 'unset']);
  });

  it('maps flag values back to the enums', () => {
    expect(spanKindsFromFlag(['client', 'server'])).toEqual([
      AppObserveSpanKind.Client,
      AppObserveSpanKind.Server,
    ]);
    expect(spanStatusCodesFromFlag(['error'])).toEqual([AppObserveSpanStatusCode.Error]);
  });

  it('returns undefined for no values', () => {
    expect(spanKindsFromFlag(undefined)).toBeUndefined();
    expect(spanKindsFromFlag([])).toBeUndefined();
    expect(spanStatusCodesFromFlag(undefined)).toBeUndefined();
  });

  it('rejects unknown values', () => {
    expect(() => spanKindsFromFlag(['bogus'])).toThrow(/Unknown span kind/);
    expect(() => spanStatusCodesFromFlag(['bogus'])).toThrow(/Unknown span status/);
  });
});
