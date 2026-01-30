import { createHash } from 'crypto';

export function getCacheVersion(paths: string[]): string {
  return createHash('sha256')
    .update(`${process.platform}@${process.arch}#${paths.join('|')}`)
    .digest('hex');
}
