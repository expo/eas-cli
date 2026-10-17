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
  if (!parsed.flags.import) {
    return { argv };
  }
  const config = await readSimulatorSessionConfigAsync(parsed.flags.import);
  const values: Record<string, unknown> = { ...config.start };
  for (const key of Object.keys(values)) {
    if (!Object.hasOwn(definitions, key) || ['import', 'json', 'non-interactive'].includes(key)) {
      throw new Error(`Unknown or invocation-only start setting "${key}" in ${config.path}.`);
    }
  }
  for (const [name, value] of Object.entries(parsed.flags)) {
    if (value !== undefined && !parsed.metadata.flags[name]?.setFromDefault) {
      values[name] = value;
    }
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
