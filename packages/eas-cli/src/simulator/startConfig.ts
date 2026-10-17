import { Interfaces, Parser } from '@oclif/core';

import { preflightControlConfigFilesAsync } from './controlConfig';
import { SimulatorSessionConfig, readSimulatorSessionConfigAsync } from './sessionConfig';

/** Reparse the effective values using the command's own validation, options and defaults. */
export async function resolveStartConfigAsync(
  argv: string[],
  definitions: Interfaces.FlagInput
): Promise<{ argv: string[]; config?: SimulatorSessionConfig }> {
  if (!argv.some(arg => arg === '--import' || arg.startsWith('--import='))) {
    return { argv };
  }
  // Relationships are checked after file values and explicit CLI overrides are combined.
  const relaxed = Object.fromEntries(
    Object.entries(definitions).map(([name, flag]) => [
      name,
      {
        ...flag,
        dependsOn: undefined,
        exclusive: undefined,
        exactlyOne: undefined,
        atLeastOne: undefined,
        relationships: undefined,
        required: false,
      },
    ])
  );
  const parsed = await Parser.parse(argv, { flags: relaxed });
  if (parsed.flags.import === undefined) {
    return { argv };
  }
  if (!parsed.flags.import.trim()) {
    throw new Error('--import requires a non-empty configuration file path.');
  }
  const config = await readSimulatorSessionConfigAsync(parsed.flags.import);
  const values: Record<string, unknown> = { ...config.start };
  for (const key of Object.keys(values)) {
    if (!Object.hasOwn(definitions, key) || ['import', 'json', 'non-interactive'].includes(key)) {
      throw new Error(`Unknown or invocation-only start setting "${key}" in ${config.path}.`);
    }
  }
  const explicit = Object.entries(parsed.flags).filter(
    ([name, value]) => value !== undefined && !parsed.metadata.flags[name]?.setFromDefault
  );
  const explicitNames = new Set(explicit.map(([name]) => name));
  const removed = new Set<string>();
  for (const [name, value] of explicit) {
    for (const excluded of definitions[name].exclusive ?? []) {
      if (!explicitNames.has(excluded)) {
        delete values[excluded];
        removed.add(excluded);
      }
    }
    values[name] = value;
  }
  // SDK selection belongs to the saved Expo Go app source, not a replacement build.
  if (removed.has('expo-go') && !explicitNames.has('sdk-version')) {
    delete values['sdk-version'];
  }
  const effectiveArgv: string[] = [];
  for (const [name, value] of Object.entries(values)) {
    const flag = definitions[name];
    if (flag.type === 'boolean') {
      if (typeof value !== 'boolean') {
        throw new Error(`Start setting "${name}" must be a boolean.`);
      }
      if (value) {
        effectiveArgv.push(`--${name}`);
      } else if (flag.allowNo) {
        effectiveArgv.push(`--no-${name}`);
      }
    } else {
      const items = Array.isArray(value) ? value : [value];
      if (Array.isArray(value) && !flag.multiple) {
        throw new Error(`Start setting "${name}" does not accept multiple values.`);
      }
      for (const item of items) {
        if (typeof item !== 'string' && typeof item !== 'number') {
          throw new Error(`Start setting "${name}" must contain a string or number.`);
        }
        effectiveArgv.push(`--${name}=${item}`);
      }
    }
  }
  await preflightControlConfigFilesAsync(config);
  return { argv: effectiveArgv, config };
}
