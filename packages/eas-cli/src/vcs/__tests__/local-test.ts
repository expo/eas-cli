import { vol } from 'memfs';

import { Ignore } from '../local';

jest.mock('fs');

beforeEach(() => {
  vol.reset();
});

describe(Ignore, () => {
  it('reads .gitignore from subdirectory', async () => {
    vol.fromJSON(
      {
        '.gitignore': 'aaa',
        'dir/.gitignore': 'bbb',
      },
      '/root'
    );

    const ignore = await Ignore.createForCopyingAsync('/root');
    expect(ignore.ignores('aaa')).toBe(true);
    expect(ignore.ignores('bbb')).toBe(false);
    expect(ignore.ignores('dir/aaa')).toBe(true);
    expect(ignore.ignores('dir/bbb')).toBe(true);
  });

  it('ignores .gitignore files if .easignore is present', async () => {
    vol.fromJSON(
      {
        '.gitignore': 'aaa',
        '.easignore': 'ccc',
        'dir/.gitignore': 'bbb',
      },
      '/root'
    );

    const ignore = await Ignore.createForCopyingAsync('/root');
    expect(ignore.ignores('aaa')).toBe(false);
    expect(ignore.ignores('bbb')).toBe(false);
    expect(ignore.ignores('ccc')).toBe(true);
    expect((ignore as any).ignoreMapping.map((i: any) => i[0])).toEqual(['', '']);
  });

  it('ignores .gitignore files in node_modules content', async () => {
    vol.fromJSON(
      {
        '.gitignore': 'aaa',
        'dir/.gitignore': 'bbb',
        'node_modules/.gitignore': 'bbb',
      },
      '/root'
    );

    const ignore = await Ignore.createForCopyingAsync('/root');
    expect(ignore.ignores('aaa')).toBe(true);
    expect(ignore.ignores('bbb')).toBe(false);
    expect(ignore.ignores('node_modules/aaa')).toBe(true);
    expect(ignore.ignores('node_modules/bbb')).toBe(true);
    expect((ignore as any).ignoreMapping.map((i: any) => i[0])).toEqual(['', '', 'dir/']);
  });

  it('applies all gitignore files in parent directories', async () => {
    vol.fromJSON(
      {
        '.gitignore': 'dir/ccc',
        'dir/.gitignore': 'bbb',
      },
      '/root'
    );

    const ignore = await Ignore.createForCopyingAsync('/root');
    expect(ignore.ignores('dir/ccc')).toBe(true);
  });

  it('ignores .git if copying', async () => {
    vol.fromJSON({}, '/root');

    const ignore = await Ignore.createForCopyingAsync('/root');
    expect(ignore.ignores('.git')).toBe(true);
  });

  it('applies ignore rules from .gitignore files in dot-directories', async () => {
    vol.fromJSON(
      {
        '.eas/.gitignore': 'secrets.txt\n',
      },
      '/root'
    );

    const ignore = await Ignore.createForCopyingAsync('/root');
    expect(ignore.ignores('.eas/secrets.txt')).toBe(true);
    expect(ignore.ignores('.eas/other.txt')).toBe(false);
  });

  it('does not throw an error if there is a trailing backslash in the gitignore', async () => {
    vol.fromJSON(
      {
        '.gitignore': 'dir\\',
      },
      '/root'
    );

    const ignore = await Ignore.createForCopyingAsync('/root');
    expect(() => ignore.ignores('dir/test')).not.toThrowError();
  });

  describe('for checking', () => {
    it('does not necessarily ignore .git', async () => {
      vol.fromJSON({}, '/root');

      const ignore = await Ignore.createForCheckingAsync('/root');
      expect(ignore.ignores('.git')).toBe(false);
    });

    it('ignores .git if present in .easignore', async () => {
      vol.fromJSON(
        {
          '.easignore': '.git\n',
        },
        '/root'
      );

      const ignore = await Ignore.createForCheckingAsync('/root');
      expect(ignore.ignores('.git')).toBe(true);
    });
  });

  describe('negation patterns', () => {
    it('does not ignore a path negated by a directory pattern in the same .gitignore', async () => {
      vol.fromJSON(
        {
          '.gitignore': '.eas/*\n!.eas/build/\n',
        },
        '/root'
      );

      const ignore = await Ignore.createForCopyingAsync('/root');
      expect(ignore.ignores('.eas/build/')).toBe(false);
      expect(ignore.ignores('.eas/build/foo.txt')).toBe(false);
      expect(ignore.ignores('.eas/other/')).toBe(true);
      expect(ignore.ignores('.eas/other.txt')).toBe(true);
    });

    it('ignores a file inside a directory matched by a glob with no negation', async () => {
      vol.fromJSON(
        {
          '.gitignore': '.eas/*\n',
        },
        '/root'
      );

      const ignore = await Ignore.createForCopyingAsync('/root');
      expect(ignore.ignores('.eas/build/foo.txt')).toBe(true);
    });

    it('does not un-ignore a file whose name matches a directory negation pattern', async () => {
      vol.fromJSON(
        {
          '.gitignore': 'build\n!build/\n',
        },
        '/root'
      );

      const ignore = await Ignore.createForCopyingAsync('/root');
      expect(ignore.ignores('build')).toBe(true);
      expect(ignore.ignores('build/')).toBe(false);
    });
  });
});
