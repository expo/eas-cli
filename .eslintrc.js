module.exports = {
  root: true,
  extends: ['universe/node'],
  rules: {
    'no-constant-condition': ['warn', { checkLoops: false }],
    'sort-imports': [
      'warn',
      {
        ignoreDeclarationSort: true,
      },
    ],
    '@typescript-eslint/no-unused-vars': 'off',
  },
};
