const rootEslintrc = require('../../.eslintrc.js');

module.exports = {
  ...rootEslintrc,
  rules: {
    ...rootEslintrc.rules,
    'async-protect/async-suffix': ['off'],
    'no-underscore-dangle': [
      'error',
      {
        allow: [...rootEslintrc.rules['no-underscore-dangle'][1].allow, '__WORKFLOW_JOB_ID'],
        allowAfterThis: true,
      },
    ],
    'import/no-extraneous-dependencies': [
      'error',
      {
        devDependencies: ['**/__integration__/**/*', '**/__unit__/**/*', '**/__mocks__/**/*'],
      },
    ],
    'node/no-sync': ['off'],
  },
  overrides: [
    {
      files: ['*.test.ts'],
      rules: {
        'no-console': 'off',
      },
    },
  ],
};
