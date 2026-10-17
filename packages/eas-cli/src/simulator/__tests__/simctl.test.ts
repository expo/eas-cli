import { resolveSimctlHostAction } from '../simctl';

describe(resolveSimctlHostAction, () => {
  it('maps the appearance command', () => {
    expect(resolveSimctlHostAction(['ui', 'appearance', 'dark'])).toEqual({
      action: 'appearance.set',
      params: { value: 'dark' },
    });
    expect(resolveSimctlHostAction(['ui', 'appearance', 'light'])).toEqual({
      action: 'appearance.set',
      params: { value: 'light' },
    });
  });

  it('maps the SpringBoard restart', () => {
    expect(
      resolveSimctlHostAction([
        'spawn',
        'launchctl',
        'kickstart',
        '-k',
        'system/com.apple.SpringBoard',
      ])
    ).toEqual({ action: 'springboard.restart', params: {} });
  });

  it('rejects every other command', () => {
    expect(resolveSimctlHostAction([])).toBeNull();
    expect(resolveSimctlHostAction(['ui', 'appearance'])).toBeNull();
    expect(resolveSimctlHostAction(['ui', 'appearance', 'sepia'])).toBeNull();
    expect(resolveSimctlHostAction(['spawn', 'launchctl', 'list'])).toBeNull();
    expect(
      resolveSimctlHostAction([
        'spawn',
        'launchctl',
        'kickstart',
        '-k',
        'system/com.apple.backboardd',
      ])
    ).toBeNull();
    expect(resolveSimctlHostAction(['openurl', 'myapp://'])).toBeNull();
  });
});
