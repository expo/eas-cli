import { errors } from '@expo/eas-build-job';
import { bunyan } from '@expo/logger';
import spawn from '@expo/turtle-spawn';

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
  const query = async (args: string[], timeout = 10000): Promise<string | null> => {
    try {
      const { stdout } = await spawn('security', [...args, keychainPath], {
        stdio: 'pipe',
        timeout,
      });
      return stdout;
    } catch {
      // A failed probe is unknown, not evidence that a certificate/key is absent.
      return null;
    }
  };

  // -s is retained for compatibility. Under the default basic policy it does not
  // filter by team; the fingerprint and provisioning profile checks bind identity.
  const expectedFingerprint = fingerprint.toUpperCase();
  const validIdentities = await query(['find-identity', '-v', '-s', `(${teamId})`], 0);
  if (validIdentities !== null && hasIdentity(validIdentities, expectedFingerprint)) {
    return;
  }

  const certificates = await query(['find-certificate', '-a', '-Z']);
  const identities = await query(['find-identity']);
  const codesigningIdentities = await query(['find-identity', '-v', '-p', 'codesigning']);
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
    },
    `iOS signing identity diagnostics: certificatePresent=${certificatePresent}, identityPresent=${identityPresent}, codesigningValid=${codesigningValid}, validIdentityQuerySucceeded=${validIdentities !== null}, trustErrors=${trustErrors.join(',') || 'none reported'} (null means the diagnostic query failed)`
  );

  let explanation: string;
  if (validIdentities === null) {
    explanation =
      'The macOS valid-identity query failed. Check keychain access on the build machine.';
  } else if (identityPresent) {
    explanation =
      'The certificate and private key are present, but macOS did not report a valid identity under its basic policy. Check certificate validity and the trust chain on the build machine.';
  } else if (certificatePresent && identityPresent === false) {
    explanation =
      'The certificate is present, but macOS did not report a matching private key identity. Check that the PKCS#12 file contains the matching private key and check the import diagnostics.';
  } else if (certificatePresent === false && identityPresent === false) {
    explanation =
      'macOS did not find the expected certificate or identity in the build keychain. Check the import diagnostics, PKCS#12 password, and export format.';
  } else {
    explanation =
      'The diagnostic queries could not determine why the identity is unavailable. Check the certificate import diagnostics and keychain access.';
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
      },
    }
  );
}

function hasIdentity(output: string, fingerprint: string): boolean {
  return [...output.matchAll(/^\s*\d+\)\s+([A-Fa-f0-9]{40})\s+"/gm)].some(
    match => match[1].toUpperCase() === fingerprint
  );
}
