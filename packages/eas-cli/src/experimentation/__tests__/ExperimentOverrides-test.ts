import { ExperimentOverrides, parseExperimentOverrides } from '../ExperimentOverrides';

jest.mock('../../env', () => ({
  __esModule: true,
  default: { experimentOverride: 'from-env:variant=treatment' },
}));

describe(parseExperimentOverrides, () => {
  it('parses a single override', () => {
    const map = parseExperimentOverrides('pricing:variant=treatment');
    expect(map.get('pricing')?.get('variant')).toBe('treatment');
  });

  it('parses multiple overrides and multiple params per namespace', () => {
    const map = parseExperimentOverrides('a:variant=x,b:limit=3,a:enabled=true');
    expect(map.get('a')?.get('variant')).toBe('x');
    expect(map.get('a')?.get('enabled')).toBe('true');
    expect(map.get('b')?.get('limit')).toBe('3');
  });

  it('returns an empty map for undefined or empty input', () => {
    expect(parseExperimentOverrides(undefined).size).toBe(0);
    expect(parseExperimentOverrides('').size).toBe(0);
    expect(parseExperimentOverrides('  ,  ').size).toBe(0);
  });

  it('skips entries without "=" or ":" and entries with an empty namespace or param', () => {
    const map = parseExperimentOverrides(
      'bogus,ns:x,variant=1,:variant=1,ns:=1,ok:variant=control'
    );
    expect([...map.keys()]).toEqual(['ok']);
  });

  it('keeps "=" and ":" inside values', () => {
    const map = parseExperimentOverrides('ns:url=https://expo.dev/a=b');
    expect(map.get('ns')?.get('url')).toBe('https://expo.dev/a=b');
  });

  it('trims whitespace and tolerates a trailing comma', () => {
    const map = parseExperimentOverrides(' ns : variant = treatment , ');
    expect(map.get('ns')?.get('variant')).toBe('treatment');
    expect(map.size).toBe(1);
  });

  it('lets later duplicates win', () => {
    const map = parseExperimentOverrides('ns:variant=a,ns:variant=b');
    expect(map.get('ns')?.get('variant')).toBe('b');
  });
});

describe(ExperimentOverrides, () => {
  it('exposes namespace and param lookups', () => {
    const overrides = new ExperimentOverrides(parseExperimentOverrides('ns:variant=treatment'));
    expect(overrides.hasNamespaceOverride('ns')).toBe(true);
    expect(overrides.hasNamespaceOverride('other')).toBe(false);
    expect(overrides.hasOverride('ns', 'variant')).toBe(true);
    expect(overrides.hasOverride('ns', 'enabled')).toBe(false);
    expect(overrides.hasOverride('other', 'variant')).toBe(false);
    expect(overrides.getOverride('ns', 'variant')).toBe('treatment');
    expect(overrides.getOverride('ns', 'enabled')).toBeUndefined();
    expect(overrides.getOverride('other', 'variant')).toBeUndefined();
  });

  it('reads EAS_EXPERIMENT_OVERRIDE through env', () => {
    const overrides = ExperimentOverrides.fromEnv();
    expect(overrides.getOverride('from-env', 'variant')).toBe('treatment');
  });

  it('empty() has no overrides', () => {
    expect(ExperimentOverrides.empty().hasNamespaceOverride('from-env')).toBe(false);
  });
});
