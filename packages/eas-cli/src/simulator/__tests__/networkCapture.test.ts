import { parseNetworkCaptureFields } from '../networkCapture';

describe(parseNetworkCaptureFields, () => {
  it('accepts repeated and comma-separated values, like serve-sim does', () => {
    expect(parseNetworkCaptureFields(['header,query', 'request-body'])).toEqual([
      'header',
      'query',
      'request-body',
    ]);
  });

  it('matches the name case-insensitively, like serve-sim does', () => {
    expect(parseNetworkCaptureFields(['Header', ' QUERY '])).toEqual(['header', 'query']);
  });

  it('keeps one of each', () => {
    expect(parseNetworkCaptureFields(['header', 'header'])).toEqual(['header']);
  });

  it('rejects a field the recorder does not know', () => {
    expect(() => parseNetworkCaptureFields(['cookies'])).toThrow(/Unknown network capture field/);
  });

  it('rejects an empty value rather than quietly keeping nothing', () => {
    expect(() => parseNetworkCaptureFields([''])).toThrow(/Empty network capture field/);
    expect(() => parseNetworkCaptureFields([',,'])).toThrow(/Empty network capture field/);
  });

  it('returns nothing when nothing was asked for', () => {
    expect(parseNetworkCaptureFields([])).toEqual([]);
  });
});
