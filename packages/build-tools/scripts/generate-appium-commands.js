// Regenerates src/steps/utils/appiumCommands.generated.ts from the upstream
// @appium/base-driver command set, so the command-summary coverage test can
// verify we handle every Appium command without importing the (heavy, ESM-source)
// package at test runtime.
//
// @appium/base-driver is NOT a dependency of this package. Like repack, we install
// it on demand into a temp directory just for this script, so nothing heavy ships
// with @expo/build-tools.
//
// Run with: yarn workspace @expo/build-tools generate-appium-commands
const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

// Track the Appium 3 line, matching the appium@^3 the worker installs for
// simulator sessions (see startAppiumRemoteSession.ts).
const APPIUM_BASE_DRIVER_VERSION = '^10';

function main() {
  const sandbox = fs.mkdtempSync(path.join(os.tmpdir(), 'appium-base-driver-'));
  try {
    fs.writeFileSync(
      path.join(sandbox, 'package.json'),
      `${JSON.stringify({ name: 'appium-base-driver-sandbox', private: true })}\n`
    );
    execFileSync(
      'npm',
      ['install', '--prefix', sandbox, `@appium/base-driver@${APPIUM_BASE_DRIVER_VERSION}`],
      { stdio: 'inherit' }
    );

    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { ALL_COMMANDS } = require(path.join(sandbox, 'node_modules', '@appium', 'base-driver'));
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
// list from @appium/base-driver (installed on demand by the generator script).
export const UPSTREAM_APPIUM_COMMANDS = [
${commands.map(command => `  '${command}',`).join('\n')}
] as const;
`;
    fs.writeFileSync(outputPath, contents);
    // eslint-disable-next-line no-console
    console.log(`Wrote ${commands.length} Appium commands to ${outputPath}`);
  } finally {
    fs.rmSync(sandbox, { recursive: true, force: true });
  }
}

main();
