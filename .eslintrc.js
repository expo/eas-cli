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
        name: 'lodash',
        message: "Please import directly to keep bundle size low: import foo from 'lodash/foo'",
      },
    ],
  },
  settings: {
    react: {
      version: 'detect',
    },
  },
};
