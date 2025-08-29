import path from 'path';
import { vol } from 'memfs';

import { WorkflowFile } from '../workflowFile';

jest.mock('fs');

describe('WorkflowFile.readWorkflowFileContentsAsync', () => {
  beforeEach(() => {
    vol.reset();
  });

  describe('absolute paths', () => {
    it('should read a file with absolute path', async () => {
      const absolutePath = '/Users/test/workflow.yml';
      const yamlContent = 'name: test\njobs:\n  build:\n    runs-on: ubuntu-latest';

      vol.fromJSON({
        [absolutePath]: yamlContent,
      });

      const result = await WorkflowFile.readWorkflowFileContentsAsync({
        projectDir: '/some/project',
        filePath: absolutePath,
      });

      expect(result.yamlConfig).toBe(yamlContent);
      expect(result.filePath).toBe(absolutePath);
    });

    it('should only try the exact absolute path when provided', async () => {
      const absolutePath = '/Users/test/workflow.yml';
      const yamlContent = 'name: test\njobs:\n  build:\n    runs-on: ubuntu-latest';

      vol.fromJSON({
        [absolutePath]: yamlContent,
        '/Users/test/workflow.yaml': 'different content', // This should not be used
      });

      const result = await WorkflowFile.readWorkflowFileContentsAsync({
        projectDir: '/some/project',
        filePath: absolutePath,
      });

      expect(result.yamlConfig).toBe(yamlContent);
      expect(result.filePath).toBe(absolutePath);
    });

    it('should fail if absolute path does not exist (no extension fallback)', async () => {
      const absolutePath = '/Users/test/nonexistent.yml';

      vol.fromJSON({
        '/Users/test/nonexistent.yaml': 'some content', // This should not be tried
      });

      await expect(
        WorkflowFile.readWorkflowFileContentsAsync({
          projectDir: '/some/project',
          filePath: absolutePath,
        })
      ).rejects.toThrow();
    });
  });

  describe('relative paths', () => {
    it('should prioritize .eas/workflows directory for relative paths', async () => {
      const projectDir = '/project';
      const relativeFilePath = 'deploy';
      const yamlContent = 'name: deploy\njobs:\n  deploy:\n    runs-on: ubuntu-latest';

      vol.fromJSON({
        [`${projectDir}/.eas/workflows/${relativeFilePath}.yml`]: yamlContent,
        [`${projectDir}/${relativeFilePath}.yml`]: 'different content',
      });

      const result = await WorkflowFile.readWorkflowFileContentsAsync({
        projectDir,
        filePath: relativeFilePath,
      });

      expect(result.yamlConfig).toBe(yamlContent);
      expect(result.filePath).toBe(`${projectDir}/.eas/workflows/${relativeFilePath}.yml`);
    });

    it('should fall back to resolving relative path if not found in .eas/workflows', async () => {
      const relativeFilePath = 'deploy.yml';
      const yamlContent = 'name: deploy\njobs:\n  deploy:\n    runs-on: ubuntu-latest';
      const resolvedPath = path.resolve(relativeFilePath);

      vol.fromJSON({
        [resolvedPath]: yamlContent,
      });

      const result = await WorkflowFile.readWorkflowFileContentsAsync({
        projectDir: '/some/project',
        filePath: relativeFilePath,
      });

      expect(result.yamlConfig).toBe(yamlContent);
      expect(result.filePath).toBe(resolvedPath);
    });
  });

  describe('error handling', () => {
    it('should throw error if no file is found in any of the search paths', async () => {
      await expect(
        WorkflowFile.readWorkflowFileContentsAsync({
          projectDir: '/project',
          filePath: 'nonexistent',
        })
      ).rejects.toThrow();
    });
  });
});
