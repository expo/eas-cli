module.exports = {
  rules: {
    'import/no-cycle': 'error',
    'import/no-extraneous-dependencies': ['error', { devDependencies: [
      '**/__tests__/**/*',
      '**/__mocks__/**/*'
    ] }],
  },
};
