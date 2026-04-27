import type { CodegenConfig } from '@graphql-codegen/cli';

import { getExpoApiBaseUrl } from './src/api';

const schema =
  process.env.GRAPHQL_SCHEMA_URL ?? new URL('/graphql', getExpoApiBaseUrl()).toString();

const config: CodegenConfig = {
  overwrite: true,
  schema,
  documents: ['src/**/!(*.d).ts'],
  generates: {
    'src/graphql/generated.ts': {
      plugins: ['typescript', 'typescript-operations'],
      config: {
        dedupeOperationSuffix: true,
      },
      hooks: {
        afterOneFileWrite: ['node ./scripts/annotate-graphql-codegen.js'],
      },
    },
    './graphql.schema.json': {
      plugins: ['introspection'],
    },
  },
};

export default config;
