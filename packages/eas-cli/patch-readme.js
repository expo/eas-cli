const fs = require('fs');

// Patch `oclif-dev readme` path and link generation
let readmeContent = fs.readFileSync('README.md', 'utf8');
readmeContent = readmeContent.replace(/\[build\//g, '[src/');
readmeContent = readmeContent.replace(/build\/commands/g, 'packages/eas-cli/src/commands');
fs.writeFileSync('README.md', readmeContent);

console.log('Patched README path generation');
