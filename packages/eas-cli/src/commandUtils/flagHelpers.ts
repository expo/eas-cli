import { Flags } from '@oclif/core';

const parseInteger =
  (command: string, limit?: number) =>
  async (input: string): Promise<number> => {
    const inputAsNumber = parseInt(input, 10);
    if (isNaN(inputAsNumber)) {
      throw new Error(`Unable to parse ${input} as a number`);
    }
    if (limit && (inputAsNumber < 1 || inputAsNumber > limit)) {
      throw new Error(`--${command} must be between 1 and ${limit}`);
    }
    return inputAsNumber;
  };

export const EasFlags = {
  offset: Flags.integer({
    description: 'Start queries from speciied index. Use for paginating results. Defaults to 0.',
    parse: parseInteger('offset'),
  }),
  limit: Flags.integer({
    description:
      'The number of query items to list at once. The default value is 50 (the maximum is 100). Using a lower value may help increase command speed.',
    parse: parseInteger('limit', 50),
  }),
  json: Flags.boolean({
    description: 'Enable JSON output, non-JSON messages will be printed to stderr',
  }),
  'non-interactive': Flags.boolean({
    description: 'Run the command in non-interactive mode',
  }),
};

// flags required to control a paginated query
// none are guaranteed for a given run of a command
export type PaginatedQueryFlags = Partial<{
  'non-interactive': boolean;
  json: boolean;
  limit: number;
  offset: number;
}>;
