import { randomInt } from 'node:crypto';
import { once } from 'node:events';
import { type AddressInfo, Server, createServer } from 'node:net';

import { SESSION_PORT_RANGE, findAvailablePortAsync } from '../remoteDeviceRunSession';

jest.mock('node:crypto', () => ({
  ...jest.requireActual<typeof import('node:crypto')>('node:crypto'),
  randomInt: jest.fn(),
}));

const servers: Server[] = [];
// findAvailablePortAsync does not return a port twice, so each test uses a port not used before.
const usedPorts = new Set<number>();

async function listenAsync(port: number): Promise<number> {
  const server = createServer();
  servers.push(server);
  server.listen(port, '127.0.0.1');
  await once(server, 'listening');
  return (server.address() as AddressInfo).port;
}

async function freePortInRangeAsync(): Promise<number> {
  const { randomInt: actualRandomInt } =
    jest.requireActual<typeof import('node:crypto')>('node:crypto');
  for (;;) {
    const port = actualRandomInt(SESSION_PORT_RANGE.min, SESSION_PORT_RANGE.max);
    if (usedPorts.has(port)) {
      continue;
    }
    try {
      await listenAsync(port);
      await new Promise<void>(resolve => servers.pop()!.close(() => resolve()));
      usedPorts.add(port);
      return port;
    } catch {
      servers.pop();
    }
  }
}

beforeEach(() => {
  jest.mocked(randomInt).mockReset();
});

afterEach(async () => {
  await Promise.all(
    servers.splice(0).map(server => new Promise<void>(resolve => server.close(() => resolve())))
  );
});

describe(findAvailablePortAsync, () => {
  it('uses a range below the Linux and macOS ephemeral port ranges', () => {
    expect(SESSION_PORT_RANGE.min).toBeGreaterThanOrEqual(1_024);
    expect(SESSION_PORT_RANGE.max).toBeLessThanOrEqual(32_768);
  });

  it('returns a free port from the session port range', async () => {
    const free = await freePortInRangeAsync();
    jest.mocked(randomInt).mockImplementation(() => free);
    const port = await findAvailablePortAsync();
    expect(port).toBe(free);
    expect(randomInt).toHaveBeenCalledWith(SESSION_PORT_RANGE.min, SESSION_PORT_RANGE.max);
    // The port is released, so the session server can bind it.
    await expect(listenAsync(port)).resolves.toBe(port);
  });

  it('skips a port that another process holds', async () => {
    const taken = await listenAsync(await freePortInRangeAsync());
    const free = await freePortInRangeAsync();
    jest
      .mocked(randomInt)
      .mockReturnValueOnce(taken as never)
      .mockReturnValue(free as never);
    await expect(findAvailablePortAsync()).resolves.toBe(free);
    expect(randomInt).toHaveBeenCalledTimes(2);
  });

  it('does not return the same port twice', async () => {
    const free = await freePortInRangeAsync();
    const other = await freePortInRangeAsync();
    jest
      .mocked(randomInt)
      .mockReturnValueOnce(free as never)
      .mockReturnValueOnce(free as never)
      .mockReturnValue(other as never);
    await expect(findAvailablePortAsync()).resolves.toBe(free);
    await expect(findAvailablePortAsync()).resolves.toBe(other);
    expect(randomInt).toHaveBeenCalledTimes(3);
  });

  it('falls back to a system-assigned port when every candidate is in use', async () => {
    const taken = await listenAsync(await freePortInRangeAsync());
    jest.mocked(randomInt).mockImplementation(() => taken);
    const port = await findAvailablePortAsync();
    expect(randomInt).toHaveBeenCalledTimes(20);
    expect(port).not.toBe(taken);
    await expect(listenAsync(port)).resolves.toBe(port);
  });

  describe('when the system assigns a port that was already returned', () => {
    // A port that findAvailablePortAsync never returned, so it is not in its set.
    const unusedPort = 1;
    function systemAssigns(...ports: number[]) {
      const address = jest.spyOn(Server.prototype, 'address');
      for (const port of ports) {
        address.mockReturnValueOnce({ address: '127.0.0.1', family: 'IPv4', port });
      }
      return address;
    }

    afterEach(() => {
      jest.restoreAllMocks();
    });

    it('skips it and returns the next one', async () => {
      const taken = await listenAsync(await freePortInRangeAsync());
      jest.mocked(randomInt).mockImplementation(() => taken);
      const first = await findAvailablePortAsync();
      const address = systemAssigns(first, unusedPort);
      await expect(findAvailablePortAsync()).resolves.toBe(unusedPort);
      expect(address).toHaveBeenCalledTimes(2);
    });

    it('fails after 20 attempts', async () => {
      const taken = await listenAsync(await freePortInRangeAsync());
      jest.mocked(randomInt).mockImplementation(() => taken);
      const first = await findAvailablePortAsync();
      const address = systemAssigns(...Array<number>(20).fill(first));
      await expect(findAvailablePortAsync()).rejects.toThrow('Could not allocate a local port');
      expect(address).toHaveBeenCalledTimes(20);
    });
  });
});
