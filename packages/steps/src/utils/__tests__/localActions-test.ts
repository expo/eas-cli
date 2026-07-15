import { isActionPath } from '../localActions';

describe(isActionPath, () => {
  it('recognizes relative paths as local action paths', () => {
    expect(isActionPath('./.eas/actions/setup')).toBe(true);
    expect(isActionPath('../../shared/actions/setup')).toBe(true);
    expect(isActionPath('  ./.eas/actions/setup/  ')).toBe(true);
  });

  it('rejects function ids and absolute or backslash-prefixed paths', () => {
    expect(isActionPath('eas/build')).toBe(false);
    expect(isActionPath('/actions/setup')).toBe(false);
    expect(isActionPath('..\\actions\\setup')).toBe(false);
  });
});
