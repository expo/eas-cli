import { isActionPath, parseActionPath } from '../localActions';

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

describe(parseActionPath, () => {
  it('parses local action paths', () => {
    expect(parseActionPath('./.eas/actions/setup')).toBe('./.eas/actions/setup');
    expect(parseActionPath('../../shared/actions/setup')).toBe('../../shared/actions/setup');
  });

  it('normalizes local action paths', () => {
    expect(parseActionPath('  ./.eas/actions/setup/  ')).toBe('./.eas/actions/setup');
  });

  it('collapses equivalent paths to the same canonical path', () => {
    expect(parseActionPath('././.eas/actions/setup')).toBe('./.eas/actions/setup');
    expect(parseActionPath('./.eas/actions/other/../setup')).toBe('./.eas/actions/setup');
    expect(parseActionPath('../shared/other/../actions/setup')).toBe('../shared/actions/setup');
  });

  it('throws for degenerate paths with no path segment', () => {
    expect(() => parseActionPath('./')).toThrow(/does not point to an action directory/);
    expect(() => parseActionPath('  ./  ')).toThrow(/does not point to an action directory/);
    expect(() => parseActionPath('../')).toThrow(/does not point to an action directory/);
    expect(() => parseActionPath('./..')).toThrow(/does not point to an action directory/);
  });

  it('throws for backslash-based paths', () => {
    expect(() => parseActionPath('./actions\\setup')).toThrow(/must not contain backslashes/);
  });

  it('throws for interpolated local action paths', () => {
    expect(() => parseActionPath('./.eas/actions/${{ inputs.name }}')).toThrow(
      /must not contain interpolation/
    );
  });

  it('parses local action paths that contain }}${{ as literal characters', () => {
    expect(parseActionPath('./.eas/actions/weird}}${{name')).toBe('./.eas/actions/weird}}${{name');
  });
});
