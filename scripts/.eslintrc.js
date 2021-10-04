const rootEslintrc = require('../.eslintrc.js');

module.exports = {
  rules: {
    'no-restricted-imports': [
      'error',
      {
        paths: rootEslintrc.rules['no-restricted-imports'][1].paths.filter(
          // using lodash in internal scripts is fine
          ({ name }) => name !== 'lodash'
        ),
      },
    ],
  },
};
