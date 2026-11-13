export function formatBytes(bytes: number): string {
  if (bytes === 0) {
    return `0`;
  }
  let multiplier = 1;
  if (bytes < 1024 * multiplier) {
    return `${Math.floor(bytes)} B`;
  }
  multiplier *= 1024;
  if (bytes < 102.4 * multiplier) {
    return `${(bytes / multiplier).toFixed(1)} KB`;
  }
  if (bytes < 1024 * multiplier) {
    return `${Math.floor(bytes / 1024)} KB`;
  }
  multiplier *= 1024;
  if (bytes < 102.4 * multiplier) {
    return `${(bytes / multiplier).toFixed(1)} MB`;
  }
  if (bytes < 1024 * multiplier) {
    return `${Math.floor(bytes / multiplier)} MB`;
  }
  multiplier *= 1024;
  if (bytes < 102.4 * multiplier) {
    return `${(bytes / multiplier).toFixed(1)} GB`;
  }
  return `${Math.floor(bytes / multiplier)} GB`;
}
