module.exports = {
  extends: ['universe/shared/typescript-analysis'],
  overrides: [
    {
      files: ['*.ts', '*.d.ts'],
      parserOptions: {
        project: './packages/eas-cli/tsconfig.json',
      },
      rules: {
        '@typescript-eslint/explicit-function-return-type': [
          'warn',
          {
            allowExpressions: true,
          },
        ],
        '@typescript-eslint/prefer-nullish-coalescing': ['warn', { ignorePrimitives: true }],
        // '@typescript-eslint/no-confusing-void-expression': 'warn',
        // '@typescript-eslint/await-thenable': 'error',
        // '@typescript-eslint/no-misused-promises': [
        //   'error',
        //   {
        //     checksVoidReturn: false,
        //   },
        // ],
        // '@typescript-eslint/no-floating-promises': 'error',
        // 'no-void': ['warn', { allowAsStatement: true }],
        // 'no-return-await': 'off',
        // '@typescript-eslint/return-await': ['error', 'always'],
        '@typescript-eslint/no-confusing-non-null-assertion': 'warn',
        '@typescript-eslint/no-extra-non-null-assertion': 'warn',
        '@typescript-eslint/prefer-as-const': 'warn',
        '@typescript-eslint/prefer-includes': 'warn',
        '@typescript-eslint/prefer-readonly': 'warn',
        '@typescript-eslint/prefer-string-starts-ends-with': 'warn',
        '@typescript-eslint/prefer-ts-expect-error': 'warn',
        '@typescript-eslint/no-unnecessary-type-assertion': 'warn',
      },
    },
  ],
};
