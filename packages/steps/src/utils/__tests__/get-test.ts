import { get, parsePath } from '../get';

describe(parsePath, () => {
  it('splits dot-separated paths', () => {
    expect(parsePath('steps.step1.outputs.out')).toEqual(['steps', 'step1', 'outputs', 'out']);
  });

  it('parses bracketed array indices', () => {
    expect(parsePath('list[0].name')).toEqual(['list', '0', 'name']);
    expect(parsePath('a[0][1]')).toEqual(['a', '0', '1']);
  });

  it('parses bracketed keys without quotes as emitted by jsepEval', () => {
    expect(parsePath('a[b]')).toEqual(['a', 'b']);
  });

  it('parses quoted bracketed keys, keeping dots inside them intact', () => {
    expect(parsePath('a["b.c"]')).toEqual(['a', 'b.c']);
    expect(parsePath("a['b']")).toEqual(['a', 'b']);
  });

  it('throws on unterminated brackets', () => {
    expect(() => parsePath('a[b')).toThrow('unterminated bracket');
    expect(() => parsePath('a["b]')).toThrow('unterminated quoted bracket');
  });
});

describe(get, () => {
  const context = {
    steps: {
      step1: {
        outputs: {
          my_output: 'value1',
        },
      },
    },
    eas: {
      job: {
        version: { buildNumber: '42' },
        secrets: null,
        list: ['first', { name: 'second' }],
      },
      runtimeVersion: undefined,
    },
  };

  it('resolves dot-separated paths, as used by template interpolation', () => {
    expect(get(context, 'steps.step1.outputs.my_output')).toBe('value1');
    expect(get(context, 'eas.job.version.buildNumber')).toBe('42');
  });

  it('resolves single identifiers, as used by jsepEval', () => {
    expect(get(context, 'steps')).toBe(context.steps);
  });

  it('resolves array indices in both bracket and dot form', () => {
    expect(get(context, 'eas.job.list[0]')).toBe('first');
    expect(get(context, 'eas.job.list[1].name')).toBe('second');
    expect(get(context, 'eas.job.list.1.name')).toBe('second');
  });

  it('resolves computed member paths emitted by jsepEval, e.g. a[b]', () => {
    expect(get(context, 'eas[job]')).toBe(context.eas.job);
    expect(get({ a: { b: 1 } }, 'a[b]')).toBe(1);
  });

  it('returns undefined for missing paths instead of throwing', () => {
    expect(get(context, 'eas.job.doesNotExist')).toBe(undefined);
    expect(get(context, 'eas.job.doesNotExist.nested')).toBe(undefined);
    expect(get(context, 'doesNotExist.at.all')).toBe(undefined);
  });

  it('returns undefined when traversing through null or undefined', () => {
    expect(get(context, 'eas.job.secrets.robotAccessToken')).toBe(undefined);
    expect(get(context, 'eas.runtimeVersion.anything')).toBe(undefined);
    expect(get(null, 'a.b')).toBe(undefined);
    expect(get(undefined, 'a')).toBe(undefined);
  });

  it('returns null values as-is rather than undefined', () => {
    expect(get(context, 'eas.job.secrets')).toBe(null);
  });

  it('prefers a verbatim own property over a nested path, like lodash.get', () => {
    expect(get({ 'a.b': 'flat', a: { b: 'nested' } }, 'a.b')).toBe('flat');
    expect(get({ a: { b: 'nested' } }, 'a.b')).toBe('nested');
  });

  it('reads properties of primitives encountered mid-path', () => {
    expect(get({ a: 'text' }, 'a.length')).toBe(4);
  });
});
