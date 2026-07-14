import { isLocalCompositeFunctionPath, parseLocalCompositeFunctionPath } from '../localCompositeFunctions';

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

describe(parseLocalCompositeFunctionPath, () => {
  it('parses local composite function paths', () => {
    expect(parseLocalCompositeFunctionPath('./.eas/functions/setup')).toBe(
      './.eas/functions/setup'
    );
    expect(parseLocalCompositeFunctionPath('../../shared/functions/setup')).toBe(
      '../../shared/functions/setup'
    );
  });

  it('normalizes local composite function paths', () => {
    expect(parseLocalCompositeFunctionPath('  ./.eas/functions/setup/  ')).toBe(
      './.eas/functions/setup'
    );
  });

  it('collapses equivalent paths to the same canonical path', () => {
    expect(parseLocalCompositeFunctionPath('././.eas/functions/setup')).toBe(
      './.eas/functions/setup'
    );
    expect(parseLocalCompositeFunctionPath('./.eas/functions/other/../setup')).toBe(
      './.eas/functions/setup'
    );
    expect(parseLocalCompositeFunctionPath('../shared/other/../functions/setup')).toBe(
      '../shared/functions/setup'
    );
  });

  it('keeps the "./" prefix for under-root directories whose name starts with ".."', () => {
    expect(parseLocalCompositeFunctionPath('./..functions/setup')).toBe('./..functions/setup');
  });

  it('throws for degenerate paths with no path segment', () => {
    expect(() => parseLocalCompositeFunctionPath('./')).toThrow(
      /does not point to a composite function directory/
    );
    expect(() => parseLocalCompositeFunctionPath('  ./  ')).toThrow(
      /does not point to a composite function directory/
    );
    expect(() => parseLocalCompositeFunctionPath('../')).toThrow(
      /does not point to a composite function directory/
    );
    expect(() => parseLocalCompositeFunctionPath('./..')).toThrow(
      /does not point to a composite function directory/
    );
  });

  it('throws for backslash-based paths', () => {
    expect(() => parseLocalCompositeFunctionPath('./functions\\setup')).toThrow(
      /must not contain backslashes/
    );
  });

  it('throws for interpolated local composite function paths', () => {
    expect(() => parseLocalCompositeFunctionPath('./.eas/functions/${{ inputs.name }}')).toThrow(
      /must not contain interpolation/
    );
  });

  it('parses local composite function paths that contain }}${{ as literal characters', () => {
    expect(parseLocalCompositeFunctionPath('./.eas/functions/weird}}${{name')).toBe(
      './.eas/functions/weird}}${{name'
    );
  });
});
