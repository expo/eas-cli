module.exports = {
  root: true,
  extends: ['universe/node'],
  plugins: ['async-protect'],
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
    'async-protect/async-suffix': 'error',
  },
  overrides: [
    {
      files: ['**/__tests__/**/*.ts', '**/__mocks__/**/*.ts'],
      rules: {
        'async-protect/async-suffix': 'off',
      },
    },
  ],
};
