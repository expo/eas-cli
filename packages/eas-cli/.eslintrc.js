module.exports = {
  rules: {
    'import/no-cycle': 'error',
    'import/no-extraneous-dependencies': [
      'error',
      { devDependencies: ['**/__tests__/**/*', '**/__mocks__/**/*'] },
    ],
    'graphql/template-strings': [
      'error',
      {
        env: 'apollo',
        schemaJson: require('./graphql.schema.json'),
      },
    ],
  },
  plugins: ['graphql'],
};
