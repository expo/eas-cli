export function stringifyFingerprintDiff(fingerprintDiff: object[]): string {
  return JSON.stringify(
    fingerprintDiff,
    (key, value) => {
      if (key === 'contents') {
        try {
          const item = JSON.parse(value);
          return item;
        } catch {
          return value;
        }
      }
      return value;
    },
    ' '
  );
}
