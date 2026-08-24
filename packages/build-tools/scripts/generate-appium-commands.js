// Regenerates src/steps/utils/appiumCommands.generated.ts from Appium and the
// XCUITest and UiAutomator2 drivers, so TypeScript can verify that we handle
// every command that can appear in Appium event timings.
//
// Appium and its drivers are NOT dependencies of this package. Like repack, we
// install them on demand into a temp directory just for this script, so nothing
// heavy ships with @expo/build-tools.
//
// Run with: yarn workspace @expo/build-tools generate-appium-commands
const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

// Track the Appium 3 line, matching the appium@^3 the worker installs for
// simulator sessions (see startAppiumRemoteSession.ts).
const APPIUM_VERSION = '^3';
const DRIVERS = [
  {
    packageName: 'appium-xcuitest-driver',
    exportName: 'XCUITestDriver',
    typeName: 'XCUITestAppiumCommand',
  },
  {
    packageName: 'appium-uiautomator2-driver',
    exportName: 'AndroidUiautomator2Driver',
    typeName: 'UiAutomator2AppiumCommand',
  },
];

function renderCommandType(typeName, commands) {
  return `export type ${typeName} =\n${commands.map(command => `  | ${serializeStringLiteral(command)}`).join('\n')};`;
}

function serializeStringLiteral(value) {
  const jsonContents = JSON.stringify(value).slice(1, -1).replaceAll('\\"', '"');
  return `'${jsonContents.replaceAll("'", "\\'")}'`;
}

function readRouteCommands(methodMap) {
  return Object.values(methodMap).flatMap(route =>
    Object.values(route).map(method => method.command)
  );
}

async function readDriverCommands({ packageName, exportName }, sandbox) {
  const packageJsonPath = require.resolve(`${packageName}/package.json`, { paths: [sandbox] });
  const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, 'utf8'));
  const modulePath = path.join(path.dirname(packageJsonPath), packageJson.exports['.'].import);
  const driverModule = await import(pathToFileURL(modulePath).href);
  const Driver = driverModule[exportName];
  return [
    ...readRouteCommands(Driver.newMethodMap),
    ...Object.values(Driver.executeMethodMap).map(method => method.command),
  ];
}

async function main() {
  const sandbox = fs.mkdtempSync(path.join(os.tmpdir(), 'appium-command-generator-'));
  try {
    fs.writeFileSync(
      path.join(sandbox, 'package.json'),
      `${JSON.stringify({ name: 'appium-command-generator-sandbox', private: true })}\n`
    );
    execFileSync(
      'npm',
      [
        'install',
        '--prefix',
        sandbox,
        `appium@${APPIUM_VERSION}`,
        ...DRIVERS.map(({ packageName }) => packageName),
      ],
      { stdio: 'inherit' }
    );

    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { ALL_COMMANDS } = require(require.resolve('@appium/base-driver', { paths: [sandbox] }));
    const baseDriverCommands = [...new Set(ALL_COMMANDS)].sort();
    const baseDriverCommandSet = new Set(baseDriverCommands);
    const driverCommands = await Promise.all(
      DRIVERS.map(async driver => ({
        typeName: driver.typeName,
        commands: [...new Set(await readDriverCommands(driver, sandbox))]
          .filter(command => !baseDriverCommandSet.has(command))
          .sort(),
      }))
    );
    const commands = [
      ...new Set([...baseDriverCommands, ...driverCommands.flatMap(({ commands }) => commands)]),
    ];

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
// list from Appium, XCUITest, and UiAutomator2 (installed on demand by the generator).
${renderCommandType('BaseDriverAppiumCommand', baseDriverCommands)}

${driverCommands
  .map(({ typeName, commands: commandsForDriver }) =>
    renderCommandType(typeName, commandsForDriver)
  )
  .join('\n\n')}

export type AppiumCommand =
  | BaseDriverAppiumCommand
  | XCUITestAppiumCommand
  | UiAutomator2AppiumCommand;
`;
    fs.writeFileSync(outputPath, contents);
    // eslint-disable-next-line no-console
    console.log(`Wrote ${commands.length} Appium commands to ${outputPath}`);
  } finally {
    fs.rmSync(sandbox, { recursive: true, force: true });
  }
}

main().catch(error => {
  // eslint-disable-next-line no-console
  console.error(error);
  process.exitCode = 1;
});
