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
    'no-constant-condition': ['warn', { checkLoops: false }],
    'no-restricted-imports': ["warn", { "name": "lodash","message":"Please import directly to keep bundle size low: import foo from 'lodash/foo'" }],
    'sort-imports': [
      'warn',
      {
        ignoreDeclarationSort: true,
      },
    ],
    'flowtype/no-types-missing-file-annotation': 'off',
  },
  settings: {
    react: {
      version: 'detect',
    },
  },
};
