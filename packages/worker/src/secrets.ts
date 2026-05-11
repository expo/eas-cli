import { EnvironmentSecret } from '@expo/eas-build-job';

export function maybeStringBase64Decode(maybeEncodedString: string): string | null {
  try {
    const buffer = Buffer.from(maybeEncodedString, 'base64');
    const decoded = buffer.toString('utf-8');
    // toString('utf-8') replaces invalid Unicode characters with \uFFFD,
    // so if the result includes it, we can assume it was not a valid text.
    return decoded.includes('\uFFFD') ? null : decoded;
  } catch {
    return null;
  }
}

export function redactSecrets(
  message: string,
  secrets: EnvironmentSecret[],
  additionalSecrets?: string[]
): string {
  const secretValues = [
    ...secrets.map(({ value }) => value),
    ...(additionalSecrets ?? []),
  ];
  const secretList = [
    ...secretValues,
    ...secretValues.map(maybeStringBase64Decode).filter((i): i is string => !!i),
  ].filter((i) => i.length > 1 && !simpleSecretsWhitelist.includes(i));

  return secretList.reduce(
    (acc, pattern) => acc.replaceAll(pattern, '*'.repeat(pattern.length)),
    message
  );
}

export const simpleSecretsWhitelist = [
  'production',
  'prod',
  'release',
  'staging',
  'preview',
  'development',
  'dev',
  'debug',
  'ios',
  'android',
  'true',
  'false',
  'null',
  'yes',
  'no',
];
