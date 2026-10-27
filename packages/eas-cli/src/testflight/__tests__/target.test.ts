import { resolveBetaFeedbackTarget } from '../target';

describe(resolveBetaFeedbackTarget, () => {
  it('reads the id and type out of a crash submission URL', () => {
    expect(
      resolveBetaFeedbackTarget({
        idOrUrl:
          'https://api.appstoreconnect.apple.com/v1/betaFeedbackCrashSubmissions/AAo2eIIfGzcb1BzuUv3xrh4',
        defaultType: 'screenshot',
      })
    ).toEqual({ id: 'AAo2eIIfGzcb1BzuUv3xrh4', type: 'crash' });
  });

  it('reads the id and type out of a screenshot submission URL', () => {
    expect(
      resolveBetaFeedbackTarget({
        idOrUrl:
          'https://api.appstoreconnect.apple.com/v1/betaFeedbackScreenshotSubmissions/AD8JvKbr0BK0Cj9OnM6WO6I',
        defaultType: 'crash',
      })
    ).toEqual({ id: 'AD8JvKbr0BK0Cj9OnM6WO6I', type: 'screenshot' });
  });

  it('falls back to the command default for a bare id', () => {
    expect(resolveBetaFeedbackTarget({ idOrUrl: 'some-id', defaultType: 'crash' })).toEqual({
      id: 'some-id',
      type: 'crash',
    });
  });

  it('lets --type override the default for a bare id', () => {
    expect(
      resolveBetaFeedbackTarget({ idOrUrl: 'some-id', type: 'screenshot', defaultType: 'crash' })
    ).toEqual({ id: 'some-id', type: 'screenshot' });
  });

  it('rejects a --type that contradicts the URL', () => {
    expect(() =>
      resolveBetaFeedbackTarget({
        idOrUrl: 'https://api.appstoreconnect.apple.com/v1/betaFeedbackCrashSubmissions/abc',
        type: 'screenshot',
        defaultType: 'screenshot',
      })
    ).toThrow('--type screenshot does not match the URL, which points at crash feedback');
  });

  it('rejects a URL that is not a beta feedback submission', () => {
    expect(() =>
      resolveBetaFeedbackTarget({
        idOrUrl: 'https://appstoreconnect.apple.com/apps/6794186602/testflight/ios',
        defaultType: 'crash',
      })
    ).toThrow('Could not tell whether');
  });

  it('ignores query strings when reading the id', () => {
    expect(
      resolveBetaFeedbackTarget({
        idOrUrl:
          'https://api.appstoreconnect.apple.com/v1/betaFeedbackCrashSubmissions/abc?include=build',
        defaultType: 'screenshot',
      })
    ).toEqual({ id: 'abc', type: 'crash' });
  });
});
