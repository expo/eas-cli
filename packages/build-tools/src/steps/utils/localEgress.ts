import downloadFile from '@expo/downloader';
import { SystemError } from '@expo/eas-build-job';
import { bunyan } from '@expo/logger';
import { BuildStepEnv } from '@expo/steps';
import spawn from '@expo/turtle-spawn';
import { createHash, randomBytes } from 'node:crypto';
import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { pipeline } from 'node:stream/promises';
import zlib from 'node:zlib';

import { sleepAsync } from '../../utils/retry';

import {
  type DetachedProcessHandle,
  type NgrokTunnelHandle,
  spawnDetached,
} from './remoteDeviceRunSession';

/**
 * Local egress routes the simulator's network traffic through the machine that
 * runs the EAS CLI, so third parties see that machine's public IP.
 *
 * Worker side: a chisel server in reverse mode listens on loopback and is exposed
 * through the session's ngrok domain. When the CLI's egress client connects, chisel
 * opens LOCAL_EGRESS_PROXY_PORT on this host and forwards every connection to the
 * CONNECT proxy the CLI runs. The macOS system proxy points at that port, so the
 * simulator's CFNetwork and WebKit traffic goes through it. Until the client
 * connects, nothing listens on the port and proxied requests fail instead of
 * leaving from this host's address.
 */

export const LOCAL_EGRESS_PROXY_HOST = '127.0.0.1';
export const LOCAL_EGRESS_PROXY_PORT = 8899;
export const LOCAL_EGRESS_USERNAME = 'eas';
export const LOCAL_EGRESS_HANDOFF_PATH = path.join(os.tmpdir(), 'eas-simulator-local-egress.json');

export const CHISEL_VERSION = '1.12.0';
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

const CHISEL_STARTUP_TIMEOUT_MS = 15_000;
const PF_WORKER_ANCHOR = 'worker';
const EGRESS_MONITOR_INTERVAL_MS = 2_000;

export type LocalEgressHandoff = {
  /** Public URL of the reverse tunnel server, reachable through ngrok. */
  url: string;
  /** Credentials for the tunnel server, as user:password. */
  auth: string;
  /** Fingerprint of the tunnel server key, for the client to pin. */
  fingerprint: string;
  /** Loopback port on this host that the client must serve. */
  port: number;
};

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
    throw new SystemError(
      `Local egress is not supported on ${platform}/${arch}. The reverse tunnel binary is available for macOS and Linux on arm64 and x64.`
    );
  }
  return `chisel_${CHISEL_VERSION}_${os}_${cpu}.gz`;
}

export function getChiselDownloadUrl(assetName: string): string {
  return `https://github.com/jpillora/chisel/releases/download/v${CHISEL_VERSION}/${assetName}`;
}

async function sha256FileAsync(filePath: string): Promise<string> {
  const hash = createHash('sha256');
  await pipeline(fs.createReadStream(filePath), hash);
  return hash.digest('hex');
}

export async function downloadChiselAsync({
  destinationDir,
  logger,
  platform = process.platform,
  arch = process.arch,
}: {
  destinationDir: string;
  logger: bunyan;
  platform?: NodeJS.Platform;
  arch?: string;
}): Promise<string> {
  const assetName = getChiselAssetName({ platform, arch });
  const expectedSha256 = CHISEL_SHA256_BY_ASSET[assetName];
  if (!expectedSha256) {
    throw new SystemError(`No pinned checksum for ${assetName}.`);
  }
  const url = getChiselDownloadUrl(assetName);
  const archivePath = path.join(destinationDir, assetName);
  logger.info(`Downloading ${url}.`);
  await downloadFile(url, archivePath, { retry: 3, timeout: 60_000 });

  const actualSha256 = await sha256FileAsync(archivePath);
  if (actualSha256 !== expectedSha256) {
    throw new SystemError(
      `Checksum mismatch for ${assetName}: expected ${expectedSha256}, got ${actualSha256}. ` +
        'The download may be corrupted or tampered with; the session was not started.'
    );
  }

  const binaryPath = path.join(destinationDir, 'chisel');
  await pipeline(
    fs.createReadStream(archivePath),
    zlib.createGunzip(),
    fs.createWriteStream(binaryPath)
  );
  await fs.promises.chmod(binaryPath, 0o755);
  return binaryPath;
}

export function generateEgressCredentials(): { user: string; password: string } {
  return { user: LOCAL_EGRESS_USERNAME, password: randomBytes(24).toString('base64url') };
}

/**
 * chisel authfile: one user, allowed to open exactly one reverse remote, the
 * proxy port on loopback. Reverse remotes are matched as `R:<interface>:<port>`.
 */
export function createChiselAuthfileContents({
  user,
  password,
  port,
}: {
  user: string;
  password: string;
  port: number;
}): string {
  const escapedHost = LOCAL_EGRESS_PROXY_HOST.replace(/\./g, '\\.');
  return JSON.stringify({ [`${user}:${password}`]: [`^R:${escapedHost}:${port}$`] });
}

export function parseChiselFingerprint(output: string): string | null {
  const match = /Fingerprint\s+(\S+)/.exec(output);
  return match?.[1] ?? null;
}

function isProcessRunning(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

export async function startChiselServerAsync({
  chiselPath,
  controlPort,
  authfilePath,
  env,
}: {
  chiselPath: string;
  controlPort: number;
  authfilePath: string;
  env: BuildStepEnv;
}): Promise<{ process: DetachedProcessHandle; fingerprint: string }> {
  const server = spawnDetached({
    command: chiselPath,
    args: [
      'server',
      '--host',
      LOCAL_EGRESS_PROXY_HOST,
      '--port',
      String(controlPort),
      '--reverse',
      '--authfile',
      authfilePath,
    ],
    env,
  });

  const deadline = Date.now() + CHISEL_STARTUP_TIMEOUT_MS;
  while (Date.now() < deadline) {
    const fingerprint = parseChiselFingerprint(server.getOutput());
    if (fingerprint) {
      return { process: server, fingerprint };
    }
    if (server.pid !== undefined && !isProcessRunning(server.pid)) {
      break;
    }
    await sleepAsync(250);
  }
  await server.stopAsync();
  throw new SystemError(
    `The reverse tunnel server did not start within ${CHISEL_STARTUP_TIMEOUT_MS / 1000}s. Output:\n${
      server.getOutput() || '<empty>'
    }`
  );
}

export function parseDefaultRouteInterface(routeOutput: string): string | null {
  const match = /^\s*interface:\s*(\S+)/m.exec(routeOutput);
  return match?.[1] ?? null;
}

/**
 * `networksetup -listnetworkserviceorder` prints each service as two lines:
 * "(1) Wi-Fi" followed by "(Hardware Port: Wi-Fi, Device: en0)". Return the
 * service name whose device matches.
 */
export function parseNetworkServiceNameForDevice(
  listOutput: string,
  device: string
): string | null {
  const lines = listOutput.split('\n').map(line => line.trim());
  for (let i = 0; i < lines.length; i++) {
    const hardwarePortMatch = /^\(Hardware Port: (.+), Device: (\S+)\)$/.exec(lines[i]);
    if (!hardwarePortMatch || hardwarePortMatch[2] !== device) {
      continue;
    }
    const serviceLineMatch = /^\(\d+\) (.+)$/.exec(lines[i - 1] ?? '');
    return serviceLineMatch?.[1] ?? hardwarePortMatch[1];
  }
  return null;
}

export async function resolveActiveNetworkServiceNameAsync({
  env,
}: {
  env: BuildStepEnv;
}): Promise<string> {
  const routeResult = await spawn('route', ['-n', 'get', 'default'], { env, stdio: 'pipe' });
  const device = parseDefaultRouteInterface(routeResult.stdout);
  if (!device) {
    throw new SystemError(
      'Could not determine the default network interface of the device host, so the system proxy ' +
        'cannot be configured. Output of `route -n get default`:\n' +
        (routeResult.stdout || '<empty>')
    );
  }
  const listResult = await spawn('networksetup', ['-listnetworkserviceorder'], {
    env,
    stdio: 'pipe',
  });
  const service = parseNetworkServiceNameForDevice(listResult.stdout, device);
  if (!service) {
    throw new SystemError(
      `Could not find the network service for interface ${device}, so the system proxy cannot be ` +
        'configured. Output of `networksetup -listnetworkserviceorder`:\n' +
        (listResult.stdout || '<empty>')
    );
  }
  return service;
}

export function buildNetworksetupProxyArgs({
  service,
  host,
  port,
}: {
  service: string;
  host: string;
  port: number;
}): string[][] {
  return [
    ['-setwebproxy', service, host, String(port)],
    ['-setsecurewebproxy', service, host, String(port)],
  ];
}

/**
 * Point the macOS system HTTP and HTTPS proxy at the loopback egress port. The
 * simulator reads these settings when it boots, so this must run before
 * `start_ios_simulator`. No bypass domains are set: any destination that
 * bypassed the proxy would leave from this host's address.
 */
export async function configureSystemProxyAsync({
  env,
  logger,
  port,
}: {
  env: BuildStepEnv;
  logger: bunyan;
  port: number;
}): Promise<{ service: string }> {
  if (process.env.ENVIRONMENT === 'development') {
    logger.info('Job running outside of EAS, not changing the system proxy.');
    return { service: '<development>' };
  }
  const service = await resolveActiveNetworkServiceNameAsync({ env });
  for (const args of buildNetworksetupProxyArgs({ service, host: LOCAL_EGRESS_PROXY_HOST, port })) {
    await spawn('networksetup', args, { env, logger });
  }
  logger.info(`System proxy for "${service}" set to ${LOCAL_EGRESS_PROXY_HOST}:${port}.`);
  return { service };
}

export function parseDnsResolvers(scutilDnsOutput: string): string[] {
  const resolvers = new Set<string>();
  for (const match of scutilDnsOutput.matchAll(/nameserver\[\d+\]\s*:\s*(\S+)/g)) {
    resolvers.add(match[1]);
  }
  return [...resolvers];
}

/**
 * Append a UDP block to the existing pf anchor rules. UDP is the traffic an HTTP
 * proxy cannot carry (QUIC, WebRTC, STUN), so without this it would leave from
 * the host's own address. DNS to the host's configured resolvers stays open for
 * the worker itself. `quick` rules match first-wins, so the existing passes to the
 * VM gateway keep working. Idempotent: lines already present are not repeated.
 */
export function buildEgressPfRules({
  existingRules,
  resolvers,
}: {
  existingRules: string;
  resolvers: string[];
}): string {
  const lines = existingRules
    .split('\n')
    .map(line => line.trim())
    .filter(line => line.length > 0);
  const additions = [
    ...resolvers.map(resolver => `pass out quick proto udp from any to ${resolver} port 53`),
    'block drop out quick inet proto udp all',
    'block drop out quick inet6 proto udp all',
  ];
  for (const addition of additions) {
    if (!lines.includes(addition)) {
      lines.push(addition);
    }
  }
  return `${lines.join('\n')}\n`;
}

export async function applyEgressPfRulesAsync({
  env,
  logger,
  workDir,
}: {
  env: BuildStepEnv;
  logger: bunyan;
  workDir: string;
}): Promise<void> {
  if (process.env.ENVIRONMENT === 'development') {
    logger.info('Job running outside of EAS, not changing pf rules.');
    return;
  }
  const existing = await spawn('sudo', ['pfctl', '-a', PF_WORKER_ANCHOR, '-sr'], {
    env,
    stdio: 'pipe',
  });
  const dns = await spawn('scutil', ['--dns'], { env, stdio: 'pipe' });
  const resolvers = parseDnsResolvers(dns.stdout);
  const rules = buildEgressPfRules({ existingRules: existing.stdout, resolvers });
  const rulesPath = path.join(workDir, 'egress-pf.conf');
  await fs.promises.writeFile(rulesPath, rules, 'utf8');
  await spawn('sudo', ['pfctl', '-a', PF_WORKER_ANCHOR, '-f', rulesPath], { env, logger });
  await spawn('sudo', ['pfctl', '-E'], { env, logger });

  const loaded = await spawn('sudo', ['pfctl', '-a', PF_WORKER_ANCHOR, '-sr'], {
    env,
    stdio: 'pipe',
  });
  if (!loaded.stdout.includes('block drop out quick inet proto udp')) {
    throw new SystemError(
      `pf did not load the UDP block for local egress. Loaded rules:\n${loaded.stdout || '<empty>'}`
    );
  }
  logger.info(
    `pf blocks direct UDP from this host${
      resolvers.length > 0 ? ` except DNS to ${resolvers.join(', ')}` : ''
    }. Direct TCP from processes that ignore the system proxy is not blocked yet.`
  );
}

export async function writeLocalEgressHandoffAsync(
  handoff: LocalEgressHandoff,
  handoffPath: string = LOCAL_EGRESS_HANDOFF_PATH
): Promise<void> {
  await fs.promises.writeFile(handoffPath, JSON.stringify(handoff), {
    encoding: 'utf8',
    mode: 0o600,
  });
}

export async function readLocalEgressHandoffAsync(
  handoffPath: string = LOCAL_EGRESS_HANDOFF_PATH
): Promise<LocalEgressHandoff | null> {
  let raw: string;
  try {
    raw = await fs.promises.readFile(handoffPath, 'utf8');
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
      return null;
    }
    throw err;
  }
  const parsed = JSON.parse(raw) as Partial<LocalEgressHandoff>;
  if (
    typeof parsed.url !== 'string' ||
    typeof parsed.auth !== 'string' ||
    typeof parsed.fingerprint !== 'string' ||
    typeof parsed.port !== 'number'
  ) {
    throw new SystemError(`Local egress handoff at ${handoffPath} is malformed.`);
  }
  return { url: parsed.url, auth: parsed.auth, fingerprint: parsed.fingerprint, port: parsed.port };
}

/** remoteConfig fields the CLI needs to start the egress client. */
export function buildEgressRemoteConfigFields(
  handoff: LocalEgressHandoff | null
): Record<string, string | number> {
  if (!handoff) {
    return {};
  }
  return {
    egressUrl: handoff.url,
    egressAuth: handoff.auth,
    egressFingerprint: handoff.fingerprint,
    egressPort: handoff.port,
  };
}

type LocalEgressResources = {
  server: DetachedProcessHandle;
  tunnel: NgrokTunnelHandle;
};

// The egress step returns before the session ends, so the resources it created
// are held here and released by the step that owns the session's lifetime.
let activeLocalEgressResources: LocalEgressResources | undefined;

export function registerLocalEgressResources(resources: LocalEgressResources): void {
  activeLocalEgressResources = resources;
}

export async function stopLocalEgressResourcesAsync(logger: bunyan): Promise<void> {
  const resources = activeLocalEgressResources;
  if (!resources) {
    return;
  }
  activeLocalEgressResources = undefined;
  const results = await Promise.allSettled([
    resources.tunnel.stopAsync(),
    resources.server.stopAsync(),
  ]);
  for (const result of results) {
    if (result.status === 'rejected') {
      logger.warn({ err: result.reason }, 'Could not stop a local egress resource.');
    }
  }
}

export async function isPortListeningAsync({
  host,
  port,
  timeoutMs = 1_000,
}: {
  host: string;
  port: number;
  timeoutMs?: number;
}): Promise<boolean> {
  return await new Promise<boolean>(resolve => {
    const socket = net.connect({ host, port });
    const finish = (listening: boolean): void => {
      socket.destroy();
      resolve(listening);
    };
    socket.setTimeout(timeoutMs, () => finish(false));
    socket.once('connect', () => finish(true));
    socket.once('error', () => finish(false));
  });
}

export function parseExitIpResponse(body: string): string {
  const parsed = JSON.parse(body) as { ip?: unknown };
  if (typeof parsed.ip !== 'string' || parsed.ip.length === 0) {
    throw new SystemError(`Unexpected exit IP response: ${body}`);
  }
  return parsed.ip;
}

export async function fetchExitIpThroughProxyAsync({
  port,
  env,
}: {
  port: number;
  env: BuildStepEnv;
}): Promise<string> {
  const result = await spawn(
    'curl',
    [
      '-sS',
      '--max-time',
      '10',
      '-x',
      `http://${LOCAL_EGRESS_PROXY_HOST}:${port}`,
      'https://api.ipify.org?format=json',
    ],
    { env, stdio: 'pipe' }
  );
  return parseExitIpResponse(result.stdout);
}

/**
 * Log when the egress client connects and disconnects, and the exit IP seen
 * through it. Never rejects: it runs in the background for the whole session.
 */
export async function monitorLocalEgressAsync({
  port,
  env,
  logger,
  signal,
}: {
  port: number;
  env: BuildStepEnv;
  logger: bunyan;
  signal: AbortSignal;
}): Promise<void> {
  let connected = false;
  try {
    while (!signal.aborted) {
      const listening = await isPortListeningAsync({ host: LOCAL_EGRESS_PROXY_HOST, port });
      if (listening && !connected) {
        connected = true;
        logger.info('Local egress client connected.');
        try {
          const exitIp = await fetchExitIpThroughProxyAsync({ port, env });
          logger.info(`Simulator traffic now exits from ${exitIp}, the egress client's address.`);
        } catch (err) {
          logger.warn(
            { err },
            'The egress client connected, but the exit IP check through it failed. Traffic may not be flowing yet.'
          );
        }
      } else if (!listening && connected) {
        connected = false;
        logger.warn(
          'Local egress client disconnected. The simulator has no internet access until it reconnects.'
        );
      }
      await sleepAsync(EGRESS_MONITOR_INTERVAL_MS);
    }
  } catch (err) {
    logger.warn({ err }, 'Local egress monitoring stopped unexpectedly.');
  }
}
