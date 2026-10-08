import { errors } from '@expo/eas-build-job';
import { bunyan } from '@expo/logger';
import spawn, { SpawnResult } from '@expo/turtle-spawn';

/** Keep the existing valid-identity gate; additional probes only explain failures. */
export async function ensureCertificateImportedAsync({
  keychainPath,
  teamId,
  fingerprint,
  logger,
}: {
  keychainPath: string;
  teamId: string;
  fingerprint: string;
  logger?: bunyan;
}): Promise<void> {
  const queryFailures: {
    query: string;
    exitStatus: number | null;
    signal: string | null;
    code: string | null;
  }[] = [];
  const query = async (name: string, args: string[], timeout = 10000): Promise<string | null> => {
    try {
      const { stdout } = await spawn('security', [...args, keychainPath], {
        stdio: 'pipe',
        timeout,
      });
      return stdout;
    } catch (error) {
      const processError =
        error instanceof Error
          ? (error as Error &
              Partial<Pick<SpawnResult, 'status' | 'signal'> & Pick<NodeJS.ErrnoException, 'code'>>)
          : undefined;
      const { status, signal, code } = processError ?? {};
      // Retain only fixed process fields, never raw output or error messages.
      queryFailures.push({
        query: name,
        exitStatus: typeof status === 'number' && Number.isInteger(status) ? status : null,
        signal:
          signal && ['SIGTERM', 'SIGKILL', 'SIGABRT', 'SIGSEGV', 'SIGINT'].includes(signal)
            ? signal
            : null,
        code: code && ['ENOENT', 'EACCES', 'EPERM', 'ETIMEDOUT'].includes(code) ? code : null,
      });
      return null;
    }
  };

  // -s is retained for compatibility. Under the default basic policy it does not
  // filter by team; the fingerprint and provisioning profile checks bind identity.
  const expectedFingerprint = fingerprint.toUpperCase();
  const validIdentities = await query(
    'validIdentity',
    ['find-identity', '-v', '-s', `(${teamId})`],
    0
  );
  if (validIdentities !== null && hasIdentity(validIdentities, expectedFingerprint)) {
    return;
  }

  const certificates = await query('certificate', ['find-certificate', '-a', '-Z']);
  const identities = await query('identity', ['find-identity']);
  const codesigningIdentities = await query('codesigningIdentity', [
    'find-identity',
    '-v',
    '-p',
    'codesigning',
  ]);
  const certificatePresent =
    certificates === null
      ? null
      : [...certificates.matchAll(/^SHA-1 hash:\s*([A-Fa-f0-9]{40})\s*$/gm)].some(
          match => match[1].toUpperCase() === expectedFingerprint
        );
  const identityPresent = identities === null ? null : hasIdentity(identities, expectedFingerprint);
  const codesigningValid =
    codesigningIdentities === null ? null : hasIdentity(codesigningIdentities, expectedFingerprint);

  // Emit only fixed fields and symbolic trust errors. Never log certificate names,
  // raw keychain output, or unrelated identities from this keychain.
  const trustErrors =
    identities === null
      ? []
      : [
          ...new Set(
            identities
              .split('\n')
              .filter(line => hasIdentity(line, expectedFingerprint))
              .flatMap(line => {
                const error = line.match(/"\s+\((CSSMERR_[A-Z0-9_]+)\)\s*$/)?.[1];
                return error ? [error] : [];
              })
          ),
        ];
  logger?.error(
    {
      certificateFingerprint: expectedFingerprint,
      validIdentityQuerySucceeded: validIdentities !== null,
      certificatePresent,
      identityPresent,
      codesigningValid,
      trustErrors,
      queryFailures,
    },
    `iOS signing identity diagnostics: certificatePresent=${certificatePresent}, identityPresent=${identityPresent}, codesigningValid=${codesigningValid}, validIdentityQuerySucceeded=${validIdentities !== null}, trustErrors=${trustErrors.join(',') || 'none reported'} (null means the diagnostic query failed), queryFailures=${JSON.stringify(queryFailures)}`
  );

  let explanation: string;
  if (validIdentities === null) {
    explanation =
      'The macOS valid-identity query failed. Give Expo support the query failure details and build URL, or check keychain access if building locally. This result does not show that the credentials need replacement.';
  } else if (codesigningValid === true) {
    explanation =
      'macOS accepted the identity under its codesigning policy, but the basic policy check did not pass. Give Expo support the build URL to investigate the validation check. A signing test is required before changing that check.';
  } else if (identityPresent) {
    explanation =
      'The certificate and private key are present, but macOS did not report a valid identity under its basic policy. Check certificate dates and the reported trust errors. Replace an expired signing certificate and update its provisioning profiles. If an issuer certificate is missing, repair the trust chain on the build machine; for EAS cloud builds, contact Expo support.';
  } else if (certificatePresent && identityPresent === false) {
    explanation =
      'The certificate is present, but macOS did not report a matching private key identity. Check that the PKCS#12 file contains the matching private key. If it does not, export the certificate together with its matching key from the original keychain. If it does, use the import diagnostics to investigate why macOS did not import the key.';
  } else if (certificatePresent === false && identityPresent === false) {
    explanation =
      'macOS did not find the expected certificate or identity in the build keychain. Read the earlier certificate import diagnostics. A MAC or export format error does not prove the password is wrong. If an image is pinned, test the same credentials on the SDK default image before replacing them.';
  } else {
    explanation =
      'The diagnostic queries could not determine why the identity is unavailable. Give Expo support the query failure details and build URL, or check keychain access if building locally. Do not infer that the certificate or private key is absent from a failed query.';
  }
  // Keep the original prefix for existing error consumers, and include guidance
  // in the exception as well as logs so callers without a logger can use it.
  throw new errors.UserError(
    errors.ErrorCode.UNKNOWN_ERROR,
    `Distribution certificate with fingerprint ${fingerprint} hasn't been imported successfully. ${explanation}`,
    {
      trackingCode: 'IOS_SIGNING_IDENTITY_VALIDATION_FAILED',
      metadata: {
        certificatePresent,
        identityPresent,
        codesigningValid,
        validIdentityQuerySucceeded: validIdentities !== null,
        trustErrors,
        queryFailures,
      },
    }
  );
}

function hasIdentity(output: string, fingerprint: string): boolean {
  return [...output.matchAll(/^\s*\d+\)\s+([A-Fa-f0-9]{40})\s+"/gm)].some(
    match => match[1].toUpperCase() === fingerprint
  );
}
