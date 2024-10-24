import fs from 'fs/promises';
import { vol } from 'memfs';

import { WorkflowValidate } from '../../commands/workflow/validate';

jest.mock('fs/promises');
jest.mock('../../log');
jest.mock('../../ora', () => ({
  ora: () => ({
    start: () => ({
      succeed: jest.fn(),
      fail: jest.fn(),
    }),
  }),
}));

describe('WorkflowValidate', () => {
  const mockValidYaml = `
    name: workflow
    on: push
    jobs:
      build:
        steps:
          - run: echo "Hello"
  `;

  const mockInvalidYaml = `
    name: workflow
    on: : : : invalid
  `;

  let command: WorkflowValidate;

  beforeEach(() => {
    vol.reset();
    jest.resetAllMocks();
  });

  describe('file validation', () => {
    describe('when file exists', () => {
      beforeEach(() => {
        (fs.access as jest.Mock).mockResolvedValue(undefined);
      });

      it('validates a correct YAML file', async () => {
        (fs.readFile as jest.Mock).mockResolvedValue(mockValidYaml);
        command = new WorkflowValidate(['./workflow.yml'], {} as any);

        await expect(command.runAsync()).resolves.not.toThrow();
      });

      it('accepts both .yml and .yaml extensions', async () => {
        (fs.readFile as jest.Mock).mockResolvedValue(mockValidYaml);

        // Test .yml extension
        command = new WorkflowValidate(['./workflow.yml'], {} as any);
        await expect(command.runAsync()).resolves.not.toThrow();

        // Test .yaml extension
        command = new WorkflowValidate(['./workflow.yaml'], {} as any);
        await expect(command.runAsync()).resolves.not.toThrow();
      });

      it('throws error for empty YAML file', async () => {
        (fs.readFile as jest.Mock).mockResolvedValue('');
        command = new WorkflowValidate(['./workflow.yml'], {} as any);

        await expect(command.runAsync()).rejects.toThrow(
          'YAML file is empty or contains only comments'
        );
      });

      it('throws error for invalid YAML syntax', async () => {
        (fs.readFile as jest.Mock).mockResolvedValue(mockInvalidYaml);
        command = new WorkflowValidate(['./workflow.yml'], {} as any);

        await expect(command.runAsync()).rejects.toThrow('YAML parsing error');
      });

      it('throws error for invalid file extension', async () => {
        command = new WorkflowValidate(['./workflow.txt'], {} as any);

        await expect(command.runAsync()).rejects.toThrow(
          'File must have a .yml or .yaml extension'
        );
      });
    });

    describe('when file does not exist', () => {
      beforeEach(() => {
        (fs.access as jest.Mock).mockRejectedValue(new Error('ENOENT'));
      });

      it('throws appropriate error', async () => {
        command = new WorkflowValidate(['./nonexistent.yml'], {} as any);

        await expect(command.runAsync()).rejects.toThrow('File does not exist');
      });
    });
  });

  describe('error handling', () => {
    it('handles unexpected errors gracefully', async () => {
      (fs.access as jest.Mock).mockResolvedValue(undefined);
      (fs.readFile as jest.Mock).mockRejectedValue(new Error('Unexpected error'));

      command = new WorkflowValidate(['./workflow.yml'], {} as any);

      await expect(command.runAsync()).rejects.toThrow('YAML parsing error: Unexpected error');
    });
  });
});
