module.exports = {
  root: true,
  extends: ['universe/node'],
  overrides: [
    {
      files: ['**/__tests__/*'],
    },
  ],
  globals: {
    jasmine: false,
  },
  rules: {
    'no-console': 'warn',
    'no-constant-condition': ['warn', { checkLoops: false }],
    'sort-imports': [
      'warn',
      {
        ignoreDeclarationSort: true,
      },
    ],
    'flowtype/no-types-missing-file-annotation': 'off',
    curly: 'warn',
    'import/no-relative-packages': 'error',
    'no-restricted-imports': [
      'error',
      {
        paths: [
          {
            name: 'lodash',
            message: "Don't use lodash, it's heavy!",
          },
          {
            name: 'node-fetch',
            message: 'Use got instead, node-fetch is used only for the GraphQL client.',
          },
        ],
      },
    ],
    '@typescript-eslint/explicit-function-return-type': [
      'warn',
      {
        allowExpressions: true,
      },
    ],
  },
  settings: {
    react: {
      version: 'detect',
    },
  },
};
