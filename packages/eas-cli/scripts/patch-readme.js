const fs = require('fs/promises');

(async () => {
  // Patch `oclif readme` path and link generation
  let readmeContent = await fs.readFile('README.md', 'utf8');
  readmeContent = readmeContent.replace(/src\/commands/g, 'packages/eas-cli/src/commands');
  await fs.writeFile('README.md', readmeContent);

  // eslint-disable-next-line no-console
  console.log('Patched README path generation');
})();
