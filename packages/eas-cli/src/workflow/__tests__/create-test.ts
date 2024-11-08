import fs from 'fs/promises';
import { vol } from 'memfs';
import prompts from 'prompts';

import { WorkflowCreate } from '../../commands/workflow/create';

jest.mock('fs/promises');
jest.mock('../../log');
jest.mock('prompts');

describe('WorkflowCreate', () => {
  const originalProcessExit = process.exit;

  beforeEach(() => {
    vol.reset();
    jest.resetAllMocks();
    process.exit = jest.fn((code?: number) => {
      throw new Error(`Process exit with code: ${code}`);
    }) as never;
  });

  afterEach(() => {
    process.exit = originalProcessExit;
  });

  describe('workflow creation', () => {
    it('creates a new workflow file with prompted name', async () => {
      (fs.access as jest.Mock).mockRejectedValue({ code: 'ENOENT' });
      (fs.mkdir as jest.Mock).mockResolvedValue(undefined);
      (fs.writeFile as jest.Mock).mockResolvedValue(undefined);
      (prompts as unknown as jest.Mock).mockResolvedValue({ fileName: 'custom.yml' });

      const command = new WorkflowCreate([], {} as any);

      await expect(command.runAsync()).resolves.not.toThrow();

      expect(prompts).toHaveBeenCalled();
      expect(fs.mkdir).toHaveBeenCalledWith('.eas/workflows', { recursive: true });
      expect(fs.writeFile).toHaveBeenCalledWith(
        '.eas/workflows/custom.yml',
        expect.stringContaining('name: Hello World')
      );
    });

    it('creates a new workflow file with provided name', async () => {
      (fs.access as jest.Mock).mockRejectedValue({ code: 'ENOENT' });
      (fs.mkdir as jest.Mock).mockResolvedValue(undefined);
      (fs.writeFile as jest.Mock).mockResolvedValue(undefined);

      const command = new WorkflowCreate(['custom.yml'], {} as any);

      await expect(command.runAsync()).resolves.not.toThrow();

      expect(prompts).not.toHaveBeenCalled();
      expect(fs.writeFile).toHaveBeenCalledWith(
        '.eas/workflows/custom.yml',
        expect.stringContaining('name: Hello World')
      );
    });

    it('exits when user cancels the prompt', async () => {
      (prompts as unknown as jest.Mock).mockResolvedValue({ fileName: undefined });
      const command = new WorkflowCreate([], {} as any);

      await expect(command.runAsync()).rejects.toThrow('Process exit with code: 0');
    });

    it('throws error for invalid file extension', async () => {
      const command = new WorkflowCreate(['workflow.txt'], {} as any);

      await expect(command.runAsync()).rejects.toThrow('must have a .yml or .yaml extension');
    });

    it('throws error if file already exists', async () => {
      (fs.access as jest.Mock).mockResolvedValue(undefined);
      const command = new WorkflowCreate(['workflow.yml'], {} as any);

      await expect(command.runAsync()).rejects.toThrow('already exists');
    });
  });
});
