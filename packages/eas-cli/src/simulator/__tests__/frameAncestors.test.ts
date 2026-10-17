import { parseCorsOriginList, parseFrameAncestorList } from '../frameAncestors';

describe(parseFrameAncestorList, () => {
  it('normalizes each value to its origin and drops duplicates', () => {
    expect(
      parseFrameAncestorList([
        ' https://Embed.Example.test/ ',
        'https://embed.example.test',
        'https://embed.example.test:8443',
        'https://*.example.test',
        'http://localhost:3000',
        'https://[::1]:4443',
      ])
    ).toEqual([
      'https://embed.example.test',
      'https://embed.example.test:8443',
      'https://*.example.test',
      'http://localhost:3000',
      'https://[::1]:4443',
    ]);
    expect(parseFrameAncestorList([])).toEqual([]);
  });

  it.each([
    ['embed.example.test', 'is not a URL'],
    ['https://embed.example.test/embed', 'must be an origin only'],
    ['https://embed.example.test/?x=1', 'must be an origin only'],
    ['http://embed.example.test', 'must use https'],
    ['https://*.test', 'cannot allow'],
  ])('rejects %s', (value, message) => {
    expect(() => parseFrameAncestorList([value])).toThrow(message);
  });

  it('rejects more than ten origins', () => {
    const origins = Array.from({ length: 11 }, (_, i) => `https://embed-${i}.example.test`);
    expect(() => parseFrameAncestorList(origins)).toThrow('at most 10 origins; received 11');
  });
});

describe(parseCorsOriginList, () => {
  it('normalizes each value to its origin and drops duplicates', () => {
    expect(
      parseCorsOriginList([
        'https://App.example.test/',
        'https://app.example.test',
        'http://localhost:8081',
      ])
    ).toEqual(['https://app.example.test', 'http://localhost:8081']);
  });

  it('names the flag in its errors', () => {
    expect(() => parseCorsOriginList(['https://app.example.test/path'])).toThrow(
      '--cors-origin https://app.example.test/path must be an origin only'
    );
    expect(() => parseCorsOriginList(['http://app.example.test'])).toThrow('--cors-origin');
  });
});
