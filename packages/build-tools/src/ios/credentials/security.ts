import spawn from '@expo/turtle-spawn';

// Diagnostic queries only. Keep the existing validation command in Keychain unchanged.
export async function findCertificateFingerprintsAsync(keychainPath: string): Promise<string[]> {
  const { stdout } = await spawn('security', ['find-certificate', '-a', '-Z', keychainPath], {
    stdio: 'pipe',
    timeout: 10000,
  });
  return [...stdout.matchAll(/^SHA-1 hash:\s*([A-Fa-f0-9]{40})\s*$/gm)].map(match =>
    match[1].toUpperCase()
  );
}

type SecurityIdentity = {
  fingerprint: string;
  trustError: string | null;
};

export async function findIdentitiesAsync(keychainPath: string): Promise<SecurityIdentity[]> {
  const { stdout } = await spawn('security', ['find-identity', keychainPath], {
    stdio: 'pipe',
    timeout: 10000,
  });
  // Return only fingerprints and symbolic trust errors, never certificate names.
  return [...stdout.matchAll(/^\s*\d+\)\s+([A-Fa-f0-9]{40})\s+"([^\n]*)/gm)].map(match => ({
    fingerprint: match[1].toUpperCase(),
    trustError: match[2].match(/"\s+\((CSSMERR_[A-Z0-9_]+)\)\s*$/)?.[1] ?? null,
  }));
}
