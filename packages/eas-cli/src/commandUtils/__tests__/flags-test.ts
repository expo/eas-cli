import { resolveNonInteractiveAndJsonFlags } from '../flags';

describe(resolveNonInteractiveAndJsonFlags, () => {
  test('returns both false when no flags are set', () => {
    expect(resolveNonInteractiveAndJsonFlags({})).toEqual({
      json: false,
      nonInteractive: false,
    });
  });

  test('--json implies --non-interactive', () => {
    expect(resolveNonInteractiveAndJsonFlags({ json: true })).toEqual({
      json: true,
      nonInteractive: true,
    });
  });

  test('--non-interactive alone does not enable json', () => {
    expect(resolveNonInteractiveAndJsonFlags({ 'non-interactive': true })).toEqual({
      json: false,
      nonInteractive: true,
    });
  });

  test('both flags explicitly set', () => {
    expect(resolveNonInteractiveAndJsonFlags({ json: true, 'non-interactive': true })).toEqual({
      json: true,
      nonInteractive: true,
    });
  });

  test('both flags explicitly false', () => {
    expect(resolveNonInteractiveAndJsonFlags({ json: false, 'non-interactive': false })).toEqual({
      json: false,
      nonInteractive: false,
    });
  });

  test('--json false with --non-interactive true', () => {
    expect(resolveNonInteractiveAndJsonFlags({ json: false, 'non-interactive': true })).toEqual({
      json: false,
      nonInteractive: true,
    });
  });
});
