// Regenerates src/steps/utils/appiumCommands.generated.ts from the upstream
// @appium/base-driver command set, so the command-summary coverage test can
// verify we handle every Appium command without importing the (heavy, ESM-source)
// package at test runtime.
//
// Run with: yarn workspace @expo/build-tools generate-appium-commands
const fs = require('node:fs');
const path = require('node:path');

// eslint-disable-next-line @typescript-eslint/no-var-requires
const { ALL_COMMANDS } = require('@appium/base-driver');

const commands = [...new Set(ALL_COMMANDS)].sort();
const outputPath = path.join(
  __dirname,
  '..',
  'src',
  'steps',
  'utils',
  'appiumCommands.generated.ts'
);

const contents = `// AUTO-GENERATED. Do not edit by hand.
// Run \`yarn workspace @expo/build-tools generate-appium-commands\` to refresh this
// list from the @appium/base-driver devDependency.
export const UPSTREAM_APPIUM_COMMANDS: readonly string[] = [
${commands.map(command => `  '${command}',`).join('\n')}
];
`;

fs.writeFileSync(outputPath, contents);
// eslint-disable-next-line no-console
console.log(`Wrote ${commands.length} Appium commands to ${outputPath}`);
