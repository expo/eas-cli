import { bunyan } from '@expo/logger';

import { runFastlane } from '../fastlane';

// Do not log raw fastlane output or spawn errors: they can contain passwords,
// command arguments, and private key attributes from set-key-partition-list.
const DIAGNOSTICS = [
  {
    pattern: /SecKeychainItemImport: MAC verification failed during PKCS12 import/i,
    message:
      'macOS could not verify the PKCS#12 MAC. Check the certificate password and PKCS#12 export format; this error does not prove that the password is wrong.',
  },
  {
    pattern: /SecKeychainItemImport: Unknown format in import/i,
    message: 'macOS did not recognize the certificate import format.',
  },
  {
    pattern: /SecKeychainItemImport:/,
    message: 'macOS reported a certificate import error (SecKeychainItemImport).',
  },
  {
    pattern: /SecKeychainItemSetAccessWithPassword:/,
    message:
      'macOS could not set access to the imported private key (SecKeychainItemSetAccessWithPassword).',
  },
  {
    pattern: /SecItemCopyMatching:/,
    message:
      'macOS could not find an item while configuring private key access (SecItemCopyMatching).',
  },
];

/** Fastlane can report security errors and still exit successfully. Keep the identity check. */
export async function runFastlaneImportCertificate({
  logger,
  certificatePath,
  certificatePassword,
  keychainPath,
  keychainPassword,
}: {
  logger: bunyan;
  certificatePath: string;
  certificatePassword: string;
  keychainPath: string;
  keychainPassword: string;
}): Promise<void> {
  try {
    const result = await runFastlane([
      'run',
      'import_certificate',
      `certificate_path:${certificatePath}`,
      `certificate_password:${certificatePassword}`,
      `keychain_path:${keychainPath}`,
      `keychain_password:${keychainPassword}`,
    ]);
    logDiagnostics(logger, result);
  } catch (error) {
    logDiagnostics(logger, error);
    // Do not attach the original error as a cause: its message includes passwords.
    throw new Error(
      'Fastlane could not complete certificate import. Check the certificate import diagnostics in the Prepare credentials logs.'
    );
  }
}

function logDiagnostics(logger: bunyan, result: unknown): void {
  if (!result || typeof result !== 'object') {
    return;
  }
  const { stdout, stderr } = result as { stdout?: unknown; stderr?: unknown };
  const output = [stdout, stderr].filter(value => typeof value === 'string').join('\n');
  for (const diagnostic of DIAGNOSTICS) {
    if (diagnostic.pattern.test(output)) {
      logger.warn(diagnostic.message);
    }
  }
}
