const { promises: fs } = require('fs');

const path = './src/graphql/generated.ts';

(async () => {
  const generatedCode = await fs.readFile(path, 'utf8');
  const comment = `/**
 * This file was generated using GraphQL Codegen
 * Command: yarn generate-graphql-code
 * Run this during development for automatic type generation when editing GraphQL documents
 * For more info and docs, visit https://graphql-code-generator.com/
 */\n\n`;

  await fs.writeFile(path, comment + generatedCode);
})();
