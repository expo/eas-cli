import { HOOK_ANCHORS, parseHookKey } from '../hooks';

describe('HOOK_ANCHORS', () => {
  it('contains the v1 anchors', () => {
    expect(Object.keys(HOOK_ANCHORS).sort()).toEqual([
      'checkout',
      'install_node_modules',
      'maestro_cloud',
      'maestro_tests',
      'submit',
    ]);
  });

  it('every entry has a non-empty description', () => {
    for (const entry of Object.values(HOOK_ANCHORS)) {
      expect(entry.description.length).toBeGreaterThan(0);
    }
  });
});

describe(parseHookKey, () => {
  it('parses valid keys', () => {
    expect(parseHookKey('before_install_node_modules')).toEqual({
      side: 'before',
      anchorId: 'install_node_modules',
    });
    expect(parseHookKey('after_maestro_cloud')).toEqual({
      side: 'after',
      anchorId: 'maestro_cloud',
    });
  });

  it('returns null for unknown anchors and malformed keys', () => {
    expect(parseHookKey('before_nonexistent')).toBeNull();
    expect(parseHookKey('install_node_modules')).toBeNull();
    expect(parseHookKey('')).toBeNull();
  });

  it('does not treat Object prototype property names as registered anchors', () => {
    expect(parseHookKey('before___proto__')).toBeNull();
    expect(parseHookKey('after_toString')).toBeNull();
    expect(parseHookKey('before_constructor')).toBeNull();
  });
});
