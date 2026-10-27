const fs = require('fs/promises');
const path = require('path');

const packageRoot = path.join(__dirname, '..');
const readmePath = path.join(packageRoot, 'README.md');
const readmeHeaderPath = path.join(__dirname, 'readme-header.md');

(async () => {
  // Patch `oclif readme` path and link generation
  let readmeContent = await fs.readFile(readmePath, 'utf8');
  readmeContent = readmeContent
    .replace(/\[src\/commands/g, '[packages/eas-cli/src/commands')
    .replace(
      /https:\/\/github\.com\/expo\/eas-cli\/blob\/v([^/]+)\/src\/commands/g,
      'https://github.com/expo/eas-cli/blob/v$1/packages/eas-cli/src/commands'
    )
    .replace(
      /packages\/eas-cli\/(?:packages\/eas-cli\/)+src\/commands/g,
      'packages/eas-cli/src/commands'
    );

  const commandReferenceMarker = '# Commands\n\n<!-- commands -->';
  const commandReferenceStart = readmeContent.indexOf(commandReferenceMarker);
  if (commandReferenceStart === -1) {
    throw new Error(`Could not find generated command reference marker in ${readmePath}`);
  }

  const readmeHeader = await fs.readFile(readmeHeaderPath, 'utf8');
  readmeContent = `${readmeHeader.trimEnd()}\n\n${readmeContent.slice(commandReferenceStart)}`;

  await fs.writeFile(readmePath, readmeContent);

  // eslint-disable-next-line no-console
  console.log('Patched README path generation and header');
})();
