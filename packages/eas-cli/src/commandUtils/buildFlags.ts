export function preprocessBuildCommandArgs(argv: string[]): string[] {
  return withOptionalSimulatorValue(argv);
}

// oclif does not support string flags with optional values. We want "--simulator"
// to prompt for a simulator, while still supporting "--simulator <name-or-udid>".
// Insert an empty string value for the bare flag before oclif parses argv.
function withOptionalSimulatorValue(argv: string[]): string[] {
  const simulatorFlagIndex = argv.indexOf('--simulator');
  const simulatorValue = argv[simulatorFlagIndex + 1];

  if (
    simulatorFlagIndex === -1 ||
    (simulatorValue !== undefined && !simulatorValue.startsWith('-'))
  ) {
    return argv;
  }

  return [...argv.slice(0, simulatorFlagIndex + 1), '', ...argv.slice(simulatorFlagIndex + 1)];
}
