import freeportAsync from 'freeport-async';

/** Get a free port or throw an error. */
export async function getFreePortAsync(rangeStart: number): Promise<number> {
  const port = await freeportAsync(rangeStart, { hostnames: [null, 'localhost'] });
  if (!port) {
    throw new Error('No available port found');
  }

  return port;
}
