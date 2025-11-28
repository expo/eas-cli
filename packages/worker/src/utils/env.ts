interface EnvOptions<T> {
  defaultValue?: T;
  transform?: (value: string) => T;
  oneOf?: EnumType;
  validate?: (value: T) => boolean;
}

interface EnumType {
  [key: string]: any;
}

const accessedEnvs = new Set<string>();

export default function env<T = string>(key: string, options: EnvOptions<T> = {}): T {
  accessedEnvs.add(key);
  const value = getValue(key, options);
  const { validate } = options;
  if (validate && !validate(value)) {
    throw new Error(`The value for ${key} env variable (= ${value}) is not valid!`);
  } else {
    return value;
  }
}

function getValue<T>(key: string, { defaultValue, transform, oneOf }: EnvOptions<T> = {}): T {
  if (key in process.env) {
    const valueRaw = process.env[key] as string;
    const value = transform ? transform(valueRaw) : (valueRaw as unknown as T);
    if (oneOf && !Object.values(oneOf).includes(value)) {
      throw new Error(`Allowed values for ${key} are: ${Object.values(oneOf).join(', ')}`);
    } else {
      return value;
    }
  } else if (defaultValue === undefined) {
    throw new Error(`Please set ${key} environment variable`);
  } else {
    return defaultValue;
  }
}

export function getAccessedEnvs(): string[] {
  return Array.from(accessedEnvs);
}
