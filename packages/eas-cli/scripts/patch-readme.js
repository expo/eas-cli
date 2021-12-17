const { promises: fs } = require('fs');

(async () => {
  // Patch `oclif readme` path and link generation
  let readmeContent = await fs.readFile('README.md', 'utf8');
  readmeContent = readmeContent.replace(/\[build\//g, '[src/');
  readmeContent = readmeContent.replace(/build\/commands/g, 'packages/eas-cli/src/commands');
  await fs.writeFile('README.md', readmeContent);

  // eslint-disable-next-line no-console
  console.log('Patched README path generation');
})();
