const fs = require('fs');

// Patch `oclif-dev readme` path and link generation
let readmeContent = fs.readFileSync('README.md', 'utf8');
readmeContent = readmeContent.replaceAll('[build/', '[src/');
readmeContent = readmeContent.replaceAll('build/commands', 'packages/eas-cli/src/commands');
fs.writeFileSync('README.md', readmeContent);
