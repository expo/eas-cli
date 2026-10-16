import chalk from 'chalk';

import { ControlAction } from './controlActions';
import { ControlPromptCancelledError, promptControlValueAsync } from './controlPrompts';
import { HostActionCatalog, HostActionCatalogEntry } from './hostActions';
import Log from '../log';

type Schema = Record<string, unknown>;
type Fields = { properties: Record<string, unknown>; required: Set<string> };

function object(value: unknown): value is Schema {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function fields(schema: Schema): Fields | null {
  if (schema.anyOf || schema.oneOf || (schema.type && schema.type !== 'object')) {
    return null;
  }
  const result: Fields = {
    properties: object(schema.properties) ? { ...schema.properties } : {},
    required: new Set(Array.isArray(schema.required) ? (schema.required as string[]) : []),
  };
  for (const child of Array.isArray(schema.allOf) ? schema.allOf : []) {
    const nested = object(child) ? fields(child) : null;
    if (!nested) {
      return null;
    }
    Object.assign(result.properties, nested.properties);
    nested.required.forEach(name => result.required.add(name));
  }
  return result;
}

async function selectFieldsAsync(
  entry: HostActionCatalogEntry,
  signal: AbortSignal
): Promise<{ fields: Fields; params: Schema } | null> {
  const alternatives = entry.oneOf ?? entry.anyOf;
  if (!alternatives) {
    const result = fields(entry);
    return result && { fields: result, params: {} };
  }
  const branches = alternatives.map(branch => (object(branch) ? fields(branch) : null));
  if (branches.some(branch => !branch)) {
    return null;
  }
  const available = branches as Fields[];
  let selected: number | undefined;
  const params: Schema = {};
  for (const name of Object.keys(available[0]?.properties ?? {})) {
    if (name === 'udid') {
      continue;
    }
    const values = available.map(branch => branch.properties[name]);
    if (!values.every(schema => object(schema) && Object.hasOwn(schema, 'const'))) {
      continue;
    }
    const constants = values.map(schema => (schema as Schema).const);
    if (new Set(constants.map(value => JSON.stringify(value))).size !== constants.length) {
      continue;
    }
    const value = await promptControlValueAsync(
      {
        type: 'select',
        message: name,
        choices: constants.map(value => ({ title: String(value), value })),
      },
      signal
    );
    selected = constants.findIndex(constant => constant === value);
    params[name] = value;
    break;
  }
  if (selected === undefined) {
    // Some upload actions expose a path to users but also accept an internal upload ID.
    const exposed = entry.args ?? (entry.upload ? [entry.upload] : []);
    const candidates = available
      .map((branch, index) => ({ branch, index }))
      .filter(
        ({ branch }) =>
          exposed.length > 0 && exposed.every(name => Object.hasOwn(branch.properties, name))
      );
    if (candidates.length !== 1) {
      return null;
    }
    selected = candidates[0].index;
  }
  const common = fields({ ...entry, anyOf: undefined, oneOf: undefined });
  if (!common || !available[selected]) {
    return null;
  }
  const chosen = available[selected];
  return {
    fields: {
      properties: { ...common.properties, ...chosen.properties },
      required: new Set([...common.required, ...chosen.required]),
    },
    params,
  };
}

function types(schema: Schema): string[] {
  return [
    schema.type ?? [],
    ...(Array.isArray(schema.anyOf) ? schema.anyOf : []),
    ...(Array.isArray(schema.oneOf) ? schema.oneOf : []),
  ].flatMap(value =>
    typeof value === 'string'
      ? [value]
      : Array.isArray(value)
        ? value.filter((item): item is string => typeof item === 'string')
        : object(value)
          ? types(value)
          : []
  );
}

function parseValue(value: string, schema: Schema): unknown {
  const accepted = types(schema);
  if (usesJson(accepted)) {
    const parsed: unknown = JSON.parse(value);
    const type = parsed === null ? 'null' : Array.isArray(parsed) ? 'array' : typeof parsed;
    if (
      accepted.includes(type) ||
      (type === 'number' && accepted.includes('integer') && Number.isInteger(parsed))
    ) {
      return parsed;
    }
    throw new Error('Enter a JSON value matching this parameter.');
  }
  if (
    (accepted.includes('number') || accepted.includes('integer')) &&
    /^-?(\d+\.?\d*|\.\d+)(e[+-]?\d+)?$/i.test(value)
  ) {
    const number = Number(value);
    if (
      Number.isFinite(number) &&
      (!accepted.includes('integer') || accepted.includes('number') || Number.isInteger(number))
    ) {
      return number;
    }
  }
  if (accepted.includes('string') || accepted.length === 0) {
    return value;
  }
  throw new Error('Enter a valid number.');
}

function usesJson(accepted: string[]): boolean {
  return ['object', 'array', 'boolean', 'null'].some(type => accepted.includes(type));
}

async function promptFieldAsync(name: string, raw: unknown, signal: AbortSignal): Promise<unknown> {
  const schema = object(raw) ? raw : {};
  if (Object.hasOwn(schema, 'const')) {
    return schema.const;
  }
  if (typeof schema.description === 'string') {
    Log.gray(schema.description);
  }
  if (Array.isArray(schema.enum)) {
    return await promptControlValueAsync(
      {
        type: 'select',
        message: name,
        choices: schema.enum.map(value => ({ title: String(value), value })),
      },
      signal
    );
  }
  const accepted = types(schema);
  if (accepted.length === 1 && accepted[0] === 'boolean') {
    return await promptControlValueAsync(
      { type: 'toggle', message: name, active: 'true', inactive: 'false', initial: false },
      signal
    );
  }
  const json = usesJson(accepted);
  const value = await promptControlValueAsync(
    {
      type: 'text',
      message: `${name}${json ? ' (JSON)' : ''}`,
      validate(value: string) {
        try {
          parseValue(value, schema);
          return true;
        } catch (error) {
          return error instanceof Error ? error.message : String(error);
        }
      },
    },
    signal
  );
  return parseValue(String(value), schema);
}

export async function promptControlActionAsync(
  action: string,
  entry: HostActionCatalogEntry,
  signal: AbortSignal
): Promise<ControlAction> {
  const selected = await selectFieldsAsync(entry, signal);
  let params: Record<string, unknown>;
  if (!selected) {
    const value = await promptControlValueAsync(
      {
        type: 'text',
        message: 'Parameters (JSON object, without udid)',
        validate(value: string) {
          try {
            return object(JSON.parse(value)) || 'Enter a JSON object.';
          } catch {
            return 'Enter a JSON object.';
          }
        },
      },
      signal
    );
    params = JSON.parse(String(value));
  } else {
    params = selected.params;
    const names = [...new Set([...(entry.args ?? []), ...Object.keys(selected.fields.properties)])];
    for (const name of names) {
      if (
        name === 'udid' ||
        Object.hasOwn(params, name) ||
        !Object.hasOwn(selected.fields.properties, name)
      ) {
        continue;
      }
      const schema = selected.fields.properties[name];
      if (!selected.fields.required.has(name)) {
        const hint =
          object(schema) && Object.hasOwn(schema, 'default')
            ? ` (default: ${JSON.stringify(schema.default)})`
            : '';
        const include = await promptControlValueAsync(
          { type: 'confirm', message: `Set optional ${name}${hint}?`, initial: false },
          signal
        );
        if (!include) {
          continue;
        }
      }
      params[name] = await promptFieldAsync(name, schema, signal);
    }
  }
  const result: ControlAction = { action, params };
  if (entry.output) {
    const outputPath = await promptControlValueAsync(
      {
        type: 'text',
        message: 'Save file to',
        validate: (value: string) => value.trim().length > 0 || 'Enter a local output path.',
      },
      signal
    );
    result.outputPath = String(outputPath);
  }
  signal.throwIfAborted();
  return result;
}

export async function runControlMenuAsync({
  catalog,
  signal,
  runActionAsync,
}: {
  catalog: HostActionCatalog;
  signal: AbortSignal;
  runActionAsync: (action: ControlAction) => Promise<void>;
}): Promise<void> {
  const choices = [
    { title: 'Exit', description: 'Close simulator controls', value: { kind: 'exit' as const } },
    ...Object.keys(catalog)
      .sort()
      .map(name => ({
        title: name.split('.').map(actionLabel).join(' › '),
        description: name,
        value: { kind: 'action' as const, name },
      })),
  ];
  signal.throwIfAborted();
  Log.newLine();
  Log.log(chalk.bold('Simulator controls'));
  Log.gray(
    `${Object.keys(catalog).length} actions · Type to search · ↑/↓ to navigate · Enter to select · Ctrl-C to exit`
  );
  while (true) {
    signal.throwIfAborted();
    const choice = (await promptControlValueAsync(
      {
        type: 'autocomplete',
        message: 'Choose a simulator action',
        choices,
        limit: 8,
        suggest: (input: string) => {
          const words = input.toLowerCase().trim().split(/\s+/);
          return Promise.resolve(
            choices.filter(choice => {
              const description =
                choice.value.kind === 'action'
                  ? (catalog[choice.value.name].description ?? '')
                  : '';
              const text = `${choice.title} ${choice.description} ${description}`.toLowerCase();
              return words.every(word => text.includes(word));
            })
          );
        },
      },
      signal
    )) as { kind: 'exit' } | { kind: 'action'; name: string };
    signal.throwIfAborted();
    if (!choice) {
      Log.error('Choose an action or Exit.');
      continue;
    }
    if (choice.kind === 'exit') {
      Log.gray('Simulator controls closed.');
      return;
    }
    try {
      Log.newLine();
      Log.log(chalk.bold(choice.name));
      if (catalog[choice.name].description) {
        Log.gray(catalog[choice.name].description);
      }
      await runActionAsync(
        await promptControlActionAsync(choice.name, catalog[choice.name], signal)
      );
    } catch (error) {
      signal.throwIfAborted();
      if (error instanceof ControlPromptCancelledError) {
        throw error;
      }
      Log.error(error instanceof Error ? error.message : String(error));
    }
    Log.newLine();
  }
}

function actionLabel(value: string): string {
  const words = value
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/[_-]/g, ' ')
    .toLowerCase();
  return words.charAt(0).toUpperCase() + words.slice(1);
}
