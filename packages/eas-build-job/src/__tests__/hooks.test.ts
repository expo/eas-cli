import { HOOK_ANCHOR_ID_BY_FUNCTION_ID, HOOK_ANCHORS, parseHookKey } from '../hooks';

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

  it('function ids are unique across anchors', () => {
    const functionIds = Object.values(HOOK_ANCHORS)
      .map(entry => ('functionId' in entry ? entry.functionId : undefined))
      .filter((id): id is NonNullable<typeof id> => id !== undefined);
    expect(new Set(functionIds).size).toBe(functionIds.length);
  });
});

describe('HOOK_ANCHOR_ID_BY_FUNCTION_ID', () => {
  it('maps every functionId back to its anchor id', () => {
    expect(HOOK_ANCHOR_ID_BY_FUNCTION_ID['eas/install_node_modules']).toBe('install_node_modules');
    expect(HOOK_ANCHOR_ID_BY_FUNCTION_ID['eas/upload_to_asc']).toBe('submit');
    expect(HOOK_ANCHOR_ID_BY_FUNCTION_ID['eas/checkout']).toBe('checkout');
    expect(HOOK_ANCHOR_ID_BY_FUNCTION_ID['eas/maestro_tests']).toBe('maestro_tests');
    expect(Object.keys(HOOK_ANCHOR_ID_BY_FUNCTION_ID)).toHaveLength(4);
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
    expect(HOOK_ANCHOR_ID_BY_FUNCTION_ID['toString']).toBeUndefined();
    expect(HOOK_ANCHOR_ID_BY_FUNCTION_ID['__proto__']).toBeUndefined();
  });
});
