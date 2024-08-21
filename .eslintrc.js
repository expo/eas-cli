module.exports = {
  root: true,
  extends: ['universe/node'],
  plugins: ['async-protect', 'node'],
  rules: {
    'no-console': 'warn',
    'no-constant-condition': ['warn', { checkLoops: false }],
    'sort-imports': [
      'warn',
      {
        ignoreDeclarationSort: true,
      },
    ],
    curly: 'warn',
    'import/no-cycle': 'error',
    'import/no-extraneous-dependencies': [
      'error',
      { devDependencies: ['**/__tests__/**/*', '**/__mocks__/**/*'] },
    ],
    'import/no-relative-packages': 'error',
    'no-restricted-imports': [
      'error',
      {
        paths: [
          {
            name: 'lodash',
            message: "Don't use lodash, it's heavy!",
          },
        ],
      },
    ],
    'no-underscore-dangle': ['error', { allow: ['__typename'] }],
    'async-protect/async-suffix': 'error',
    'node/no-sync': 'error',
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
