import { isLocalCompositeFunctionPath } from '../localCompositeFunctions';

describe(isLocalCompositeFunctionPath, () => {
  it('recognizes relative paths as local composite function paths', () => {
    expect(isLocalCompositeFunctionPath('./.eas/functions/setup')).toBe(true);
    expect(isLocalCompositeFunctionPath('../../shared/functions/setup')).toBe(true);
    expect(isLocalCompositeFunctionPath('  ./.eas/functions/setup/  ')).toBe(true);
  });

  it('rejects function ids and absolute or backslash-prefixed paths', () => {
    expect(isLocalCompositeFunctionPath('eas/build')).toBe(false);
    expect(isLocalCompositeFunctionPath('/functions/setup')).toBe(false);
    expect(isLocalCompositeFunctionPath('..\\functions\\setup')).toBe(false);
  });
});
