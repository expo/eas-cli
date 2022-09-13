import { Flags } from '@oclif/core';

export const getPaginatedQueryOptions = (flags: {
  json: boolean;
  'non-interactive': boolean;
  offset: number | undefined;
  limit: number | undefined;
}): PaginatedQueryOptions => {
  return {
    json: flags.json,
    offset: flags.offset ?? 0,
    nonInteractive: flags['non-interactive'],
    ...('limit' in flags && { limit: flags.limit }),
  };
};

const parseFlagInputStringAsInteger = (
  input: string,
  flagName: string,
  lowerLimit: number,
  upperLimit: number
): number => {
  const inputAsNumber = Number(input);
  if (isNaN(inputAsNumber)) {
    throw new Error(`Unable to parse ${input} as a number`);
  }
  if (inputAsNumber < lowerLimit || inputAsNumber > upperLimit) {
    throw new Error(`--${flagName} must be between ${lowerLimit} and ${upperLimit}`);
  }
  return inputAsNumber;
};

export const EasPaginatedQueryFlags = {
  offset: Flags.integer({
    description: 'Start queries from specified index. Use for paginating results. Defaults to 0.',
    // eslint-disable-next-line async-protect/async-suffix
    parse: async input =>
      parseFlagInputStringAsInteger(input, 'offset', 0, Number.MAX_SAFE_INTEGER),
  }),
  limit: Flags.integer({
    description:
      'The number of query items to list at once. The default value is 50 (the maximum is 100). Using a lower value may help increase command speed.',
    // eslint-disable-next-line async-protect/async-suffix
    parse: async input => parseFlagInputStringAsInteger(input, 'limit', 1, 100),
  }),
};

// options required to control a paginated query
// from user input
export type PaginatedQueryOptions = {
  nonInteractive: boolean;
  json: boolean;
  limit?: number;
  offset: number;
};
