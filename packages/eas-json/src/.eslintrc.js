module.exports = {
  extends: ['universe/shared/typescript-analysis'],
  overrides: [
    {
      files: ['*.ts', '*.d.ts'],
      parserOptions: {
        project: './packages/eas-json/tsconfig.json',
      },
      rules: {
        '@typescript-eslint/explicit-function-return-type': [
          'warn',
          {
            allowExpressions: true,
          },
        ],
      },
    },
  ],
};
