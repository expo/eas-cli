import spawnAsync from '@expo/spawn-async';
import * as fs from 'fs-extra';
import { createHash } from 'node:crypto';
import dns from 'node:dns/promises';
import http from 'node:http';
import net from 'node:net';
import path from 'node:path';
import readline from 'node:readline';
import zlib from 'node:zlib';

import {
  EAS_SIMULATOR_EGRESS_AUTH,
  EAS_SIMULATOR_EGRESS_FINGERPRINT,
  EAS_SIMULATOR_EGRESS_PORT,
  EAS_SIMULATOR_EGRESS_URL,
} from './env';
import { LocalEgressConfig } from './utils';
import fetch from '../fetch';
import Log from '../log';
import { getCacheDirectory } from '../utils/paths';

/**
 * Local egress client. Two pieces run on the developer's machine for the life of
 * a simulator session started with `--egress local`:
 *
 * 1. An HTTP proxy on loopback that carries the simulator's traffic out to the
 *    internet from this machine. It supports CONNECT tunnels (HTTPS, WSS), plain
 *    HTTP requests with absolute URLs, and HTTP upgrades (WS). It refuses
 *    destinations on this machine's local networks: the requests it forwards
 *    come from code running in the remote simulator, not from the developer.
 * 2. A chisel client that connects out to the session's tunnel server and asks it
 *    to listen on the same loopback port on the device host, forwarding every
 *    connection back here. The device host's system proxy points at that port.
 */

export const LOCAL_EGRESS_PROXY_HOST = '127.0.0.1';

const CHISEL_VERSION = '1.12.0';
// sha256 of the release .gz assets, cross-checked against chisel_1.12.0_checksums.txt.
const CHISEL_SHA256_BY_ASSET: Record<string, string> = {
  'chisel_1.12.0_darwin_arm64.gz':
    '707a4b932eea214765146504a0df246cefc415b4297af65a80dd67cf69ba85a9',
  'chisel_1.12.0_darwin_amd64.gz':
    '4aeae36c867f11c8e8c3f2b913a0e063ea3c6d29e1c14a52ed2e6eef8cfc4395',
  'chisel_1.12.0_linux_amd64.gz':
    'f3f180f1d93aa72cce4e6386f98cc06569a0146fbd65eb4423cf83e6434bcfe6',
  'chisel_1.12.0_linux_arm64.gz':
    '2ec6152cd2c74fe0146d4d79e4e7aa174521368c56e433d55e023a92ea404ec3',
};

const MAX_CONCURRENT_CONNECTIONS = 512;
const UPSTREAM_ATTEMPT_TIMEOUT_MS = 5_000;
const UPSTREAM_RESPONSE_TIMEOUT_MS = 30_000;
const SOCKET_IDLE_TIMEOUT_MS = 120_000;
const HOP_BY_HOP_REQUEST_HEADERS = new Set(['proxy-connection', 'proxy-authorization']);

export function readLocalEgressConfigFromEnv(env: NodeJS.ProcessEnv): LocalEgressConfig {
  const url = env[EAS_SIMULATOR_EGRESS_URL];
  const auth = env[EAS_SIMULATOR_EGRESS_AUTH];
  const fingerprint = env[EAS_SIMULATOR_EGRESS_FINGERPRINT];
  const port = Number(env[EAS_SIMULATOR_EGRESS_PORT]);
  if (!url || !auth || !fingerprint || !Number.isInteger(port) || port <= 0) {
    throw new Error(
      'The current simulator session was not started with local egress, so there is no egress ' +
        `client to run (${EAS_SIMULATOR_EGRESS_URL} is not set). Start one with ` +
        '`eas simulator:start --platform ios --egress local`.'
    );
  }
  return { url, auth, fingerprint, port };
}

// ---------------------------------------------------------------------------
// Destination policy
// ---------------------------------------------------------------------------

export class EgressPolicyError extends Error {
  constructor(host: string, address?: string) {
    super(
      `Refused to connect to ${host}${address && address !== host ? ` (${address})` : ''}: ` +
        'local, private, link-local, and multicast addresses are not reachable through local egress.'
    );
    this.name = 'EgressPolicyError';
  }
}

function isForbiddenIpv4(address: string): boolean {
  const octets = address.split('.').map(Number);
  if (
    octets.length !== 4 ||
    octets.some(octet => !Number.isInteger(octet) || octet < 0 || octet > 255)
  ) {
    return true;
  }
  const [a, b] = octets;
  return (
    a === 0 || // "this" network
    a === 10 || // private
    a === 127 || // loopback
    (a === 100 && b >= 64 && b <= 127) || // carrier-grade NAT
    (a === 169 && b === 254) || // link-local, cloud metadata
    (a === 172 && b >= 16 && b <= 31) || // private
    (a === 192 && b === 168) || // private
    a >= 224 // multicast and reserved
  );
}

function expandIpv6(address: string): number[] | null {
  const withoutZone = address.split('%')[0];
  const halves = withoutZone.split('::');
  if (halves.length > 2) {
    return null;
  }
  const head = halves[0] ? halves[0].split(':') : [];
  const tail = halves.length === 2 && halves[1] ? halves[1].split(':') : [];
  if ([...head, ...tail].some(group => group.includes('.'))) {
    return null;
  }
  const missing = 8 - head.length - tail.length;
  if (missing < 0 || (halves.length === 1 && missing !== 0)) {
    return null;
  }
  const groups = [...head, ...new Array<string>(missing).fill('0'), ...tail].map(group =>
    parseInt(group, 16)
  );
  if (groups.some(group => Number.isNaN(group) || group < 0 || group > 0xffff)) {
    return null;
  }
  return groups;
}

function isForbiddenIpv6(address: string): boolean {
  const lower = address.toLowerCase();
  const mappedIpv4 = /^(?:0*:)*:ffff:(\d+\.\d+\.\d+\.\d+)$/.exec(lower);
  if (mappedIpv4) {
    return isForbiddenIpv4(mappedIpv4[1]);
  }
  const groups = expandIpv6(lower);
  if (!groups) {
    return true;
  }
  const isUnspecified = groups.every(group => group === 0);
  const isLoopback = groups.slice(0, 7).every(group => group === 0) && groups[7] === 1;
  if (isUnspecified || isLoopback) {
    return true;
  }
  if (groups.slice(0, 5).every(group => group === 0) && groups[5] === 0xffff) {
    const embedded = `${groups[6] >> 8}.${groups[6] & 0xff}.${groups[7] >> 8}.${groups[7] & 0xff}`;
    return isForbiddenIpv4(embedded);
  }
  const first = groups[0];
  return (
    (first & 0xfe00) === 0xfc00 || // fc00::/7 unique local
    (first & 0xffc0) === 0xfe80 || // fe80::/10 link-local
    (first & 0xff00) === 0xff00 // ff00::/8 multicast
  );
}

/** True for any address the egress client must never connect to. */
export function isForbiddenEgressAddress(address: string): boolean {
  switch (net.isIP(address)) {
    case 4:
      return isForbiddenIpv4(address);
    case 6:
      return isForbiddenIpv6(address);
    default:
      return true;
  }
}

export type EgressTargetResolver = (hostname: string) => Promise<string[]>;

/**
 * IPv4 first. Developer networks often have broken or slow IPv6, and a hung
 * first attempt would stall the simulator's request for the whole timeout.
 */
export function orderEgressAddresses(addresses: { address: string; family: number }[]): string[] {
  const ordered = [
    ...addresses.filter(({ family }) => family === 4),
    ...addresses.filter(({ family }) => family !== 4),
  ].map(({ address }) => address);
  return [...new Set(ordered)];
}

/**
 * Resolve a destination hostname to the addresses the proxy may connect to,
 * refusing anything local. Every address the name resolves to is checked, so a
 * name that mixes public and private records is refused as a whole, and
 * connections are made to the returned addresses rather than by re-resolving.
 */
export const resolveEgressTargetAsync: EgressTargetResolver = async hostname => {
  const host = hostname.replace(/^\[|\]$/g, '');
  const lowerHost = host.toLowerCase();
  if (
    lowerHost === 'localhost' ||
    lowerHost.endsWith('.localhost') ||
    lowerHost.endsWith('.local')
  ) {
    throw new EgressPolicyError(host);
  }
  if (net.isIP(host)) {
    if (isForbiddenEgressAddress(host)) {
      throw new EgressPolicyError(host);
    }
    return [host];
  }
  const addresses = await dns.lookup(host, { all: true, verbatim: true });
  if (addresses.length === 0) {
    throw new Error(`Could not resolve ${host}.`);
  }
  const forbidden = addresses.find(({ address }) => isForbiddenEgressAddress(address));
  if (forbidden) {
    throw new EgressPolicyError(host, forbidden.address);
  }
  return orderEgressAddresses(addresses);
};

// ---------------------------------------------------------------------------
// Proxy server
// ---------------------------------------------------------------------------

export type LocalEgressProxyStats = { active: number; total: number; refused: number };

export type LocalEgressProxyServer = {
  port: number;
  getStats: () => LocalEgressProxyStats;
  closeAsync: () => Promise<void>;
};

function parseAuthority(authority: string, defaultPort: number): { host: string; port: number } {
  const match = /^(\[[^\]]+\]|[^:]+)(?::(\d+))?$/.exec(authority);
  if (!match) {
    throw new Error(`Invalid destination "${authority}".`);
  }
  const port = match[2] ? Number(match[2]) : defaultPort;
  if (!Number.isInteger(port) || port <= 0 || port > 65535) {
    throw new Error(`Invalid destination port in "${authority}".`);
  }
  return { host: match[1], port };
}

/** Try each validated address in order; the first that connects wins. */
async function connectUpstreamAsync({
  addresses,
  port,
}: {
  addresses: string[];
  port: number;
}): Promise<net.Socket> {
  let lastError: Error | undefined;
  for (const address of addresses) {
    try {
      return await connectOnceAsync({ host: address, port });
    } catch (err) {
      lastError = err instanceof Error ? err : new Error(String(err));
    }
  }
  throw lastError ?? new Error(`No addresses to connect to on port ${port}.`);
}

async function connectOnceAsync({
  host,
  port,
}: {
  host: string;
  port: number;
}): Promise<net.Socket> {
  return await new Promise((resolve, reject) => {
    const socket = net.connect({ host, port });
    const timeout = setTimeout(() => {
      socket.destroy();
      reject(new Error(`Timed out connecting to ${host}:${port}.`));
    }, UPSTREAM_ATTEMPT_TIMEOUT_MS);
    socket.once('connect', () => {
      clearTimeout(timeout);
      resolve(socket);
    });
    socket.once('error', err => {
      clearTimeout(timeout);
      reject(err);
    });
  });
}

function pipeBothWays(a: net.Socket, b: net.Socket, onClose: () => void): void {
  let closed = false;
  const finish = (): void => {
    if (closed) {
      return;
    }
    closed = true;
    a.destroy();
    b.destroy();
    onClose();
  };
  for (const socket of [a, b]) {
    socket.setTimeout(SOCKET_IDLE_TIMEOUT_MS, finish);
    socket.on('error', finish);
    socket.on('close', finish);
  }
  a.pipe(b);
  b.pipe(a);
}

function statusForError(err: unknown): number {
  return err instanceof EgressPolicyError ? 403 : 502;
}

function filteredRawHeaders(rawHeaders: string[]): string[] {
  const result: string[] = [];
  for (let i = 0; i < rawHeaders.length; i += 2) {
    if (!HOP_BY_HOP_REQUEST_HEADERS.has(rawHeaders[i].toLowerCase())) {
      result.push(rawHeaders[i], rawHeaders[i + 1]);
    }
  }
  return result;
}

export async function startLocalEgressProxyServerAsync({
  host = LOCAL_EGRESS_PROXY_HOST,
  port,
  resolveTargetAsync = resolveEgressTargetAsync,
}: {
  host?: string;
  port: number;
  resolveTargetAsync?: EgressTargetResolver;
}): Promise<LocalEgressProxyServer> {
  const stats: LocalEgressProxyStats = { active: 0, total: 0, refused: 0 };
  const acquire = (): (() => void) | null => {
    if (stats.active >= MAX_CONCURRENT_CONNECTIONS) {
      stats.refused += 1;
      return null;
    }
    stats.active += 1;
    stats.total += 1;
    let released = false;
    return () => {
      if (!released) {
        released = true;
        stats.active -= 1;
      }
    };
  };

  const server = http.createServer();

  // HTTPS and WSS: the simulator asks for a raw tunnel to host:port.
  server.on('connect', (req, clientSocket, head) => {
    void (async () => {
      const release = acquire();
      if (!release) {
        clientSocket.end('HTTP/1.1 503 Service Unavailable\r\n\r\n');
        return;
      }
      try {
        const { host: targetHost, port: targetPort } = parseAuthority(req.url ?? '', 443);
        const addresses = await resolveTargetAsync(targetHost);
        const upstream = await connectUpstreamAsync({ addresses, port: targetPort });
        Log.debug(`[egress] CONNECT ${targetHost}:${targetPort}`);
        clientSocket.write('HTTP/1.1 200 Connection Established\r\n\r\n');
        if (head.length > 0) {
          upstream.write(head);
        }
        // Node types the client side of 'connect' and 'upgrade' as a Duplex; it is a net.Socket.
        pipeBothWays(clientSocket as net.Socket, upstream, release);
      } catch (err) {
        release();
        Log.debug(
          `[egress] CONNECT ${req.url} refused: ${err instanceof Error ? err.message : err}`
        );
        if (!clientSocket.destroyed) {
          clientSocket.end(
            `HTTP/1.1 ${statusForError(err)} ${http.STATUS_CODES[statusForError(err)]}\r\n\r\n`
          );
        }
      }
    })();
  });

  // Plain HTTP: the simulator sends the absolute URL in the request line.
  server.on('request', (req, res) => {
    void (async () => {
      let url: URL;
      try {
        url = new URL(req.url ?? '');
      } catch {
        res.writeHead(400).end('This proxy only accepts requests with absolute URLs.');
        return;
      }
      if (url.protocol !== 'http:') {
        res.writeHead(400).end(`Unsupported URL scheme ${url.protocol}`);
        return;
      }
      const release = acquire();
      if (!release) {
        res.writeHead(503).end();
        return;
      }
      try {
        const addresses = await resolveTargetAsync(url.hostname);
        const upstreamSocket = await connectUpstreamAsync({
          addresses,
          port: url.port ? Number(url.port) : 80,
        });
        Log.debug(`[egress] ${req.method} ${url.host}`);
        const headers = { ...req.headers };
        for (const name of HOP_BY_HOP_REQUEST_HEADERS) {
          delete headers[name];
        }
        const upstreamRequest = http.request({
          // The socket is already connected to a validated address.
          createConnection: () => upstreamSocket,
          method: req.method,
          path: `${url.pathname}${url.search}`,
          headers,
          // Keep the Host header the simulator sent; we connect by resolved address.
          setHost: false,
          timeout: UPSTREAM_RESPONSE_TIMEOUT_MS,
        });
        upstreamRequest.on('timeout', () =>
          upstreamRequest.destroy(new Error('Upstream timed out.'))
        );
        upstreamRequest.on('response', upstreamResponse => {
          res.writeHead(upstreamResponse.statusCode ?? 502, upstreamResponse.headers);
          upstreamResponse.pipe(res);
        });
        upstreamRequest.on('error', err => {
          Log.debug(`[egress] ${req.method} ${url.host} failed: ${err.message}`);
          if (!res.headersSent) {
            res.writeHead(502);
          }
          res.end();
        });
        res.on('close', release);
        req.pipe(upstreamRequest);
      } catch (err) {
        release();
        Log.debug(
          `[egress] ${req.method} ${url.host} refused: ${err instanceof Error ? err.message : err}`
        );
        res.writeHead(statusForError(err)).end();
      }
    })();
  });

  // WebSocket over plain HTTP: forward the upgrade request as-is over a raw socket.
  server.on('upgrade', (req, clientSocket, head) => {
    void (async () => {
      const release = acquire();
      if (!release) {
        clientSocket.end('HTTP/1.1 503 Service Unavailable\r\n\r\n');
        return;
      }
      try {
        const url = new URL(req.url ?? '');
        if (url.protocol !== 'http:') {
          throw new Error(`Unsupported URL scheme ${url.protocol}`);
        }
        const addresses = await resolveTargetAsync(url.hostname);
        const upstream = await connectUpstreamAsync({
          addresses,
          port: url.port ? Number(url.port) : 80,
        });
        const rawHeaders = filteredRawHeaders(req.rawHeaders);
        const headerLines: string[] = [];
        for (let i = 0; i < rawHeaders.length; i += 2) {
          headerLines.push(`${rawHeaders[i]}: ${rawHeaders[i + 1]}`);
        }
        upstream.write(
          `${req.method} ${url.pathname}${url.search} HTTP/1.1\r\n${headerLines.join('\r\n')}\r\n\r\n`
        );
        if (head.length > 0) {
          upstream.write(head);
        }
        // Node types the client side of 'connect' and 'upgrade' as a Duplex; it is a net.Socket.
        pipeBothWays(clientSocket as net.Socket, upstream, release);
      } catch (err) {
        release();
        Log.debug(
          `[egress] upgrade ${req.url} refused: ${err instanceof Error ? err.message : err}`
        );
        if (!clientSocket.destroyed) {
          clientSocket.end(
            `HTTP/1.1 ${statusForError(err)} ${http.STATUS_CODES[statusForError(err)]}\r\n\r\n`
          );
        }
      }
    })();
  });

  server.on('clientError', (_err, socket) => {
    if (!socket.destroyed) {
      socket.end('HTTP/1.1 400 Bad Request\r\n\r\n');
    }
  });

  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, host, () => {
      resolve();
    });
  });
  const address = server.address();
  const boundPort = address && typeof address !== 'string' ? address.port : port;

  return {
    port: boundPort,
    getStats: () => ({ ...stats }),
    closeAsync: async () => {
      await new Promise<void>(resolve => {
        server.close(() => {
          resolve();
        });
        server.closeAllConnections();
      });
    },
  };
}

// ---------------------------------------------------------------------------
// chisel client
// ---------------------------------------------------------------------------

export function getChiselAssetName({
  platform,
  arch,
}: {
  platform: NodeJS.Platform;
  arch: string;
}): string {
  const os = platform === 'darwin' ? 'darwin' : platform === 'linux' ? 'linux' : null;
  const cpu = arch === 'arm64' ? 'arm64' : arch === 'x64' ? 'amd64' : null;
  if (!os || !cpu) {
    throw new Error(
      `Local egress is not supported on ${platform}/${arch}. The tunnel client is available for macOS and Linux on arm64 and x64.`
    );
  }
  return `chisel_${CHISEL_VERSION}_${os}_${cpu}.gz`;
}

export async function ensureChiselBinaryAsync({
  platform = process.platform,
  arch = process.arch,
}: { platform?: NodeJS.Platform; arch?: string } = {}): Promise<string> {
  const assetName = getChiselAssetName({ platform, arch });
  const expectedSha256 = CHISEL_SHA256_BY_ASSET[assetName];
  const binaryDir = path.join(getCacheDirectory(), 'chisel', CHISEL_VERSION);
  const binaryPath = path.join(binaryDir, 'chisel');
  if (await fs.pathExists(binaryPath)) {
    return binaryPath;
  }

  const url = `https://github.com/jpillora/chisel/releases/download/v${CHISEL_VERSION}/${assetName}`;
  Log.log(`Downloading the tunnel client (chisel ${CHISEL_VERSION})...`);
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Failed to download ${url}: ${response.status} ${response.statusText}`);
  }
  const archive = Buffer.from(await response.arrayBuffer());
  const actualSha256 = createHash('sha256').update(archive).digest('hex');
  if (actualSha256 !== expectedSha256) {
    throw new Error(
      `Checksum mismatch for ${assetName}: expected ${expectedSha256}, got ${actualSha256}. ` +
        'The download may be corrupted or tampered with; the egress client was not started.'
    );
  }
  await fs.ensureDir(binaryDir);
  const temporaryPath = `${binaryPath}.${process.pid}.tmp`;
  await fs.writeFile(temporaryPath, zlib.gunzipSync(archive), { mode: 0o755 });
  await fs.move(temporaryPath, binaryPath, { overwrite: true });
  return binaryPath;
}

export function buildChiselClientArgs({
  url,
  fingerprint,
  port,
  localPort = port,
}: {
  url: string;
  fingerprint: string;
  /** Port the tunnel server listens on, on the device host. */
  port: number;
  /** Port the proxy listens on here. Differs from `port` only when both run on one machine. */
  localPort?: number;
}): string[] {
  const remote = `R:${LOCAL_EGRESS_PROXY_HOST}:${port}:${LOCAL_EGRESS_PROXY_HOST}:${localPort}`;
  return [
    'client',
    '--fingerprint',
    fingerprint,
    '--keepalive',
    '25s',
    '--max-retry-count',
    '-1',
    url,
    remote,
  ];
}

export function classifyChiselClientLogLine(line: string): 'connected' | 'disconnected' | 'other' {
  if (line.includes('Connected (Latency')) {
    return 'connected';
  }
  if (/Disconnected|Connection error|Retrying in|Give up/.test(line)) {
    return 'disconnected';
  }
  return 'other';
}

/**
 * Run the egress client until `signal` aborts. Rejects if the tunnel client exits
 * on its own, which means the simulator has lost its route to the internet.
 */
export async function runLocalEgressAsync({
  url,
  auth,
  fingerprint,
  port,
  localPort = port,
  signal,
  onConnected,
  onDisconnected,
}: LocalEgressConfig & {
  /** Only for tests that run both ends on one machine; defaults to `port`. */
  localPort?: number;
  signal: AbortSignal;
  onConnected?: () => void;
  onDisconnected?: (line: string) => void;
}): Promise<void> {
  if (signal.aborted) {
    return;
  }
  const chiselPath = await ensureChiselBinaryAsync();
  const proxy = await startLocalEgressProxyServerAsync({ port: localPort });
  Log.debug(`[egress] proxy listening on ${LOCAL_EGRESS_PROXY_HOST}:${proxy.port}`);

  const chisel = spawnAsync(
    chiselPath,
    buildChiselClientArgs({ url, fingerprint, port, localPort }),
    {
      // The credential goes through the environment so it does not appear in `ps`.
      env: { ...process.env, AUTH: auth },
      stdio: ['ignore', 'pipe', 'pipe'],
    }
  );
  const child = chisel.child;

  let connected = false;
  const handleLine = (line: string): void => {
    Log.debug(`[egress] ${line}`);
    switch (classifyChiselClientLogLine(line)) {
      case 'connected':
        connected = true;
        onConnected?.();
        break;
      case 'disconnected':
        if (connected) {
          connected = false;
          onDisconnected?.(line);
        }
        break;
      case 'other':
        break;
    }
  };
  for (const stream of [child.stdout, child.stderr]) {
    if (stream) {
      readline.createInterface({ input: stream }).on('line', handleLine);
    }
  }

  const stopChild = (): void => {
    if (child.exitCode === null && !child.killed) {
      child.kill('SIGTERM');
    }
  };
  signal.addEventListener('abort', stopChild, { once: true });

  try {
    await chisel;
    if (!signal.aborted) {
      throw new Error('The egress tunnel client exited unexpectedly.');
    }
  } catch (err) {
    if (!signal.aborted) {
      throw new Error(
        `The egress tunnel client stopped: ${err instanceof Error ? err.message : String(err)}. ` +
          'The simulator has no internet access until it runs again.'
      );
    }
  } finally {
    signal.removeEventListener('abort', stopChild);
    stopChild();
    await proxy.closeAsync();
  }
}
