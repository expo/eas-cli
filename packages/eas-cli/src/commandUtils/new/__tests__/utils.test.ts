import path from 'path';

import { printDirectory } from '../utils';

describe('utils', () => {
  describe('printDirectory', () => {
    let cwdSpy: jest.SpyInstance;

    beforeEach(() => {
      // Mock process.cwd() to return a predictable value
      cwdSpy = jest.spyOn(process, 'cwd').mockReturnValue('/Users/test/projects');
    });

    afterEach(() => {
      jest.restoreAllMocks();
    });

    it('should return "." for the current directory', () => {
      const result = printDirectory('/Users/test/projects');
      expect(result).toBe('.');
    });

    it('should return relative path with "./" prefix for subdirectory', () => {
      const result = printDirectory('/Users/test/projects/my-app');
      expect(result).toBe('./my-app');
    });

    it('should return relative path with "./" prefix for nested subdirectory', () => {
      const result = printDirectory('/Users/test/projects/nested/my-app');
      expect(result).toBe('./nested/my-app');
    });

    it('should return absolute path for directory outside cwd', () => {
      const result = printDirectory('/Users/other/projects/my-app');
      expect(result).toBe('/Users/other/projects/my-app');
    });

    it('should return absolute path for parent directory', () => {
      const result = printDirectory('/Users/test');
      expect(result).toBe('/Users/test');
    });

    it('should handle relative paths and convert them correctly', () => {
      // Relative path resolves to absolute first, then converts back to relative
      const result = printDirectory('my-app');
      expect(result).toBe('./my-app');
    });

    it('should handle relative paths with "./" already', () => {
      const result = printDirectory('./my-app');
      expect(result).toBe('./my-app');
    });

    it('should handle relative paths with "../" (goes outside cwd)', () => {
      const result = printDirectory('../other-project');
      // This goes outside cwd, so should return absolute path
      expect(result).toBe('/Users/test/other-project');
    });

    it('should handle complex relative paths', () => {
      const result = printDirectory('./nested/deep/project');
      expect(result).toBe('./nested/deep/project');
    });

    it('should normalize paths correctly', () => {
      const result = printDirectory('/Users/test/projects/./my-app/../my-app');
      expect(result).toBe('./my-app');
    });

    it('should handle paths in real cwd', () => {
      // Restore mock to test with real cwd
      cwdSpy.mockRestore();
      const realCwd = process.cwd();

      // Test with current directory
      const result1 = printDirectory(realCwd);
      expect(result1).toBe('.');

      // Test with subdirectory
      const subDir = path.join(realCwd, 'test-dir');
      const result2 = printDirectory(subDir);
      expect(result2).toBe('./test-dir');
    });
  });
});
