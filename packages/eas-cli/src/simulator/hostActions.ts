import { randomUUID } from 'crypto';
import * as fs from 'fs-extra';
import path from 'path';
import WebSocket from 'ws';
import { z } from 'zod';

import { PreviewApiAccess } from './utils';
import fetch, { RequestError, httpsProxyAgent } from '../fetch';

export type HostActionResult = {
  stdout: string;
  stderr: string;
  exitCode: number;
};

export type HostActionConnection = {
  readonly signal: AbortSignal;
  readonly udid: string;
  requestAsync(action: string, params?: Record<string, unknown>): Promise<HostActionResult>;
  close(): void;
};

const SchemaNode = z.looseObject({
  type: z.union([z.string(), z.array(z.string())]).optional(),
  properties: z.record(z.string(), z.unknown()).optional(),
  required: z.array(z.string()).optional(),
  allOf: z.array(z.unknown()).optional(),
  anyOf: z.array(z.unknown()).optional(),
  oneOf: z.array(z.unknown()).optional(),
});

const CatalogEntry = SchemaNode.extend({
  description: z.string().optional(),
  args: z.array(z.string()).optional(),
  upload: z.string().optional(),
  uploadAs: z.enum(['path', 'id']).optional(),
  uploadWhen: z.record(z.string(), z.unknown()).optional(),
  keepUpload: z.boolean().optional(),
  output: z.enum(['path', 'base64']).optional(),
});

const Catalog = z.record(z.string(), CatalogEntry);

export type HostActionCatalog = z.infer<typeof Catalog>;
export type HostActionCatalogEntry = z.infer<typeof CatalogEntry>;

export type HostActionDevice = { udid: string; name?: string; runtime?: string };

const PreviewConfig = z.object({ device: z.string().min(1) });

const ReplyId = z.object({ id: z.number() });

const SocketMessage = z.union([
  z.object({ ready: z.literal(true) }),
  z.object({ id: z.number(), error: z.string() }),
  z.object({
    id: z.number(),
    stdout: z.string(),
    stderr: z.string(),
    exitCode: z.number(),
  }),
]);

const HOST_ACTION_TIMEOUT_MS = 130_000;
const PREVIEW_API_TIMEOUT_MS = 30_000;
const PREVIEW_UNAVAILABLE_MESSAGE =
  'The simulator preview server is unavailable. The session may have ended or expired. Check it with `eas simulator:get`, or start a new session with `eas simulator:start`.';
const UPLOAD_CHUNK_BYTES = 2 * 1024 * 1024;
const NAMED_VALUE = /^([A-Za-z][A-Za-z0-9]*)=(.*)$/s;
const NUMBER = /^-?(\d+\.?\d*|\.\d+)(e[+-]?\d+)?$/i;

function previewEndpoint(apiUrl: string, endpoint: string): URL {
  const base = new URL(apiUrl);
  const loopback =
    base.hostname === 'localhost' ||
    base.hostname === '[::1]' ||
    /^127(?:\.\d{1,3}){3}$/.test(base.hostname);
  if (base.protocol !== 'https:' && (base.protocol !== 'http:' || !loopback)) {
    throw new Error(
      'Simulator actions require HTTPS for remote preview servers. HTTP is supported only on localhost or a loopback address. Start a new session with `eas simulator:start`.'
    );
  }
  base.search = '';
  base.hash = '';
  if (!base.pathname.endsWith('/')) {
    base.pathname += '/';
  }
  return new URL(endpoint, base);
}

async function fetchSimulatorUdidAsync({ apiUrl, token }: PreviewApiAccess): Promise<string> {
  let text: string;
  try {
    const response = await fetch(previewEndpoint(apiUrl, 'api').toString(), {
      headers: { Authorization: `Bearer ${token}` },
      redirect: 'error',
      signal: AbortSignal.timeout(PREVIEW_API_TIMEOUT_MS),
    });
    text = await response.text();
  } catch (error) {
    if (error instanceof RequestError && error.response.status === 404) {
      throw new Error(PREVIEW_UNAVAILABLE_MESSAGE);
    }
    if (error instanceof RequestError && [401, 403].includes(error.response.status)) {
      throw new Error(
        `The simulator preview server refused the session token (HTTP ${error.response.status}). Run \`eas simulator:get\` to check that the session still runs, then try again.`
      );
    }
    if (error instanceof Error && error.name === 'AbortError') {
      throw new Error(
        `The simulator preview server did not answer within ${PREVIEW_API_TIMEOUT_MS / 1000} seconds. Run \`eas simulator:get\` to check that the session still runs, then try again.`
      );
    }
    throw error;
  }
  let body: unknown = null;
  try {
    body = JSON.parse(text);
  } catch {}
  const config = PreviewConfig.safeParse(body);
  if (!config.success) {
    throw new Error(
      'The simulator preview server did not report which simulator it streams. The session may still be starting. Wait a few seconds and run the command again.'
    );
  }
  return config.data.device;
}

export async function fetchHostActionDeviceAsync(
  { apiUrl, token }: PreviewApiAccess,
  udid: string
): Promise<HostActionDevice> {
  const response = await fetch(previewEndpoint(apiUrl, 'grid/api/catalog').toString(), {
    headers: { Authorization: `Bearer ${token}` },
    redirect: 'error',
    signal: AbortSignal.timeout(PREVIEW_API_TIMEOUT_MS),
  });
  const catalog = z
    .object({
      devices: z.array(
        z.object({ device: z.string(), name: z.string(), runtime: z.string().optional() })
      ),
    })
    .parse(await response.json());
  const device = catalog.devices.find(device => device.device === udid);
  return device ? { udid, name: device.name, runtime: device.runtime } : { udid };
}

function refusedError(error: string): Error {
  return error.startsWith('unknown action')
    ? new Error(
        'This simulator session runs a serve-sim version that does not support this action. Start a new session with `eas simulator:start` to get a newer version.'
      )
    : new Error(`The simulator refused the request: ${error}`);
}

export async function connectHostActionsAsync(
  access: PreviewApiAccess,
  { timeoutMs = HOST_ACTION_TIMEOUT_MS }: { timeoutMs?: number } = {}
): Promise<HostActionConnection> {
  const udid = await fetchSimulatorUdidAsync(access);
  const socketUrl = previewEndpoint(access.apiUrl, 'exec-ws');
  socketUrl.protocol = socketUrl.protocol === 'https:' ? 'wss:' : 'ws:';
  const ws = new WebSocket(
    socketUrl.toString(),
    [`serve-sim.token.${access.token}`],
    httpsProxyAgent ? { agent: httpsProxyAgent } : {}
  );

  type Pending = {
    resolve: (result: HostActionResult) => void;
    reject: (error: Error) => void;
    timer: NodeJS.Timeout;
  };
  const pending = new Map<number, Pending>();
  const controller = new AbortController();
  let nextId = 1;
  let lost: Error | null = null;
  let ready = false;

  function settle(id: number): Pending | undefined {
    const request = pending.get(id);
    if (request) {
      pending.delete(id);
      clearTimeout(request.timer);
    }
    return request;
  }

  function loseConnection(error: Error): void {
    if (lost) {
      return;
    }
    lost = error;
    controller.abort(error);
    for (const id of [...pending.keys()]) {
      settle(id)?.reject(error);
    }
    ws.terminate();
  }

  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => {
      fail(
        new Error(
          `The simulator preview server did not accept the connection within ${PREVIEW_API_TIMEOUT_MS / 1000} seconds. Check that the session still runs with \`eas simulator:get\`, then try again.`
        )
      );
    }, PREVIEW_API_TIMEOUT_MS);
    const fail = (error: Error): void => {
      clearTimeout(timer);
      reject(error);
      loseConnection(error);
    };

    ws.on('message', data => {
      let message: unknown;
      try {
        message = JSON.parse(data.toString());
      } catch {
        return;
      }
      const parsed = SocketMessage.safeParse(message);
      if (!parsed.success) {
        const id = ReplyId.safeParse(message);
        if (id.success) {
          settle(id.data.id)?.reject(
            new Error(
              'The simulator preview server sent a reply that this version of eas-cli cannot read. Update eas-cli and try again.'
            )
          );
        }
        return;
      }
      const reply = parsed.data;
      if ('ready' in reply) {
        ready = true;
        clearTimeout(timer);
        resolve();
      } else if ('error' in reply) {
        settle(reply.id)?.reject(refusedError(reply.error));
      } else {
        settle(reply.id)?.resolve({
          stdout: reply.stdout,
          stderr: reply.stderr,
          exitCode: reply.exitCode,
        });
      }
    });
    ws.on('unexpected-response', (_req, res) => {
      res.destroy();
      fail(
        new Error(
          res.statusCode === 404
            ? PREVIEW_UNAVAILABLE_MESSAGE
            : `The simulator preview server refused the connection (HTTP ${res.statusCode}). The session token may be out of date. Run \`eas simulator:get\` to check the session, then try again.`
        )
      );
    });
    ws.on('error', error => {
      fail(
        new Error(
          `Could not connect to the simulator preview server: ${error.message}. Check your network connection and that the session still runs.`
        )
      );
    });
    ws.on('close', () => {
      fail(
        new Error(
          ready
            ? 'The simulator preview server closed the connection before it answered. The action may still have run. Check the current state before you try again.'
            : 'The simulator preview server closed the connection during setup. The session token may be invalid or expired, or the session may run an older serve-sim version. Check the session with `eas simulator:get` before starting a new session.'
        )
      );
    });
  });

  return {
    signal: controller.signal,
    udid,
    async requestAsync(action, params = {}) {
      if (lost) {
        throw lost;
      }
      const id = nextId++;
      const message = JSON.stringify({ id, action, params: { ...params, udid } });
      return await new Promise<HostActionResult>((resolve, reject) => {
        const timer = setTimeout(() => {
          loseConnection(
            new Error(
              `The simulator did not answer within ${Math.round(timeoutMs / 1000)} seconds. The action may still have run. Check the session with \`eas simulator:get\` and the current state before you try again.`
            )
          );
        }, timeoutMs);
        pending.set(id, { resolve, reject, timer });
        try {
          ws.send(message, error => {
            if (error) {
              loseConnection(error);
            }
          });
        } catch (error) {
          loseConnection(error instanceof Error ? error : new Error(String(error)));
        }
      });
    },
    close() {
      loseConnection(new Error('The simulator action connection was closed.'));
    },
  };
}

export async function fetchHostActionCatalogAsync(
  connection: HostActionConnection
): Promise<HostActionCatalog> {
  const result = await connection.requestAsync('actions.describe');
  let body: unknown = null;
  try {
    body = JSON.parse(result.stdout);
  } catch {}
  const catalog = Catalog.safeParse(body);
  if (result.exitCode !== 0 || !catalog.success) {
    throw new Error(
      'The simulator did not return its list of actions. Start a new session with `eas simulator:start` to get a newer serve-sim version.'
    );
  }
  return catalog.data;
}

function collectProperties(node: unknown, into: Map<string, unknown[]>): void {
  const parsed = SchemaNode.safeParse(node);
  if (!parsed.success) {
    return;
  }
  for (const [name, schema] of Object.entries(parsed.data.properties ?? {})) {
    into.set(name, [...(into.get(name) ?? []), schema]);
  }
  const { allOf = [], anyOf = [], oneOf = [] } = parsed.data;
  for (const child of [...allOf, ...anyOf, ...oneOf]) {
    collectProperties(child, into);
  }
}

function hostActionProperties(entry: HostActionCatalogEntry): Map<string, unknown[]> {
  const properties = new Map<string, unknown[]>();
  collectProperties(entry, properties);
  properties.delete('udid');
  return properties;
}

function positionalNames(entry: HostActionCatalogEntry): string[] {
  return entry.args ?? Object.keys(entry.properties ?? {}).filter(name => name !== 'udid');
}

function requiredProperties(node: unknown): Set<string> {
  const parsed = SchemaNode.safeParse(node);
  if (!parsed.success) {
    return new Set();
  }
  const required = new Set(parsed.data.required ?? []);
  for (const child of parsed.data.allOf ?? []) {
    requiredProperties(child).forEach(name => required.add(name));
  }
  const branches = [...(parsed.data.anyOf ?? []), ...(parsed.data.oneOf ?? [])].map(
    requiredProperties
  );
  for (const name of branches[0] ?? []) {
    if (branches.every(branch => branch.has(name))) {
      required.add(name);
    }
  }
  return required;
}

function acceptsType(schema: unknown, types: string[]): boolean {
  const node = SchemaNode.safeParse(schema);
  if (!node.success) {
    return false;
  }
  const own = [node.data.type ?? []].flat();
  return (
    own.some(type => types.includes(type)) ||
    [...(node.data.anyOf ?? []), ...(node.data.oneOf ?? [])].some(child =>
      acceptsType(child, types)
    )
  );
}

function coerce(value: string, schemas: unknown[]): unknown {
  if (/^[[{]/.test(value) && schemas.some(schema => acceptsType(schema, ['array', 'object']))) {
    try {
      return JSON.parse(value);
    } catch {
      return value;
    }
  }
  if (NUMBER.test(value) && schemas.some(schema => acceptsType(schema, ['number', 'integer']))) {
    return Number(value);
  }
  if (
    (value === 'true' || value === 'false') &&
    schemas.some(schema => acceptsType(schema, ['boolean']))
  ) {
    return value === 'true';
  }
  return value;
}

export function formatHostActionUsage(name: string, entry: HostActionCatalogEntry): string {
  const required = requiredProperties(entry);
  const alternatives = (entry.anyOf ?? entry.oneOf ?? []).map(branch =>
    [...requiredProperties(branch)].filter(
      property => property !== 'udid' && !required.has(property)
    )
  );
  const requiredAlternatives =
    alternatives.length > 0 && alternatives.every(properties => properties.length === 1)
      ? alternatives.map(([property]) => property)
      : [];
  let describedAlternatives = false;
  const names = positionalNames(entry).flatMap(property => {
    if (requiredAlternatives.includes(property)) {
      if (describedAlternatives) {
        return [];
      }
      describedAlternatives = true;
      return [
        `<${requiredAlternatives.map(name => (name === property ? name : `${name}=...`)).join('|')}>`,
      ];
    }
    return [required.has(property) ? `<${property}>` : `[${property}]`];
  });
  return [name, ...names].join(' ');
}

export function buildHostActionParams(
  name: string,
  entry: HostActionCatalogEntry,
  values: string[]
): Record<string, unknown> {
  const properties = hostActionProperties(entry);
  const params: Record<string, unknown> = {};
  const positional: string[] = [];
  for (const value of values) {
    const named = NAMED_VALUE.exec(value);
    if (!named || !properties.has(named[1])) {
      positional.push(value);
    } else if (Object.hasOwn(params, named[1])) {
      throw new Error(`${named[1]} is given twice for ${name}.`);
    } else {
      params[named[1]] = coerce(named[2], properties.get(named[1]) ?? []);
    }
  }
  const open = positionalNames(entry).filter(property => !Object.hasOwn(params, property));
  if (positional.length > open.length) {
    throw new Error(
      `Too many values for ${name}. Usage: eas simulator:control ${formatHostActionUsage(name, entry)}. Name a value with name=value.`
    );
  }
  positional.forEach((value, index) => {
    params[open[index]] = coerce(value, properties.get(open[index]) ?? []);
  });
  return params;
}

export async function assertHostActionOutputAsync(
  name: string,
  entry: HostActionCatalogEntry,
  outputPath: string | undefined
): Promise<void> {
  if (!outputPath) {
    if (entry.output === 'base64') {
      throw new Error(`${name} returns a file. Pass --output with the path to save it to.`);
    }
    return;
  }
  if (!entry.output) {
    throw new Error(`${name} does not return a file, so --output does not apply.`);
  }
  if ((await fs.stat(outputPath).catch(() => null))?.isDirectory()) {
    if (entry.output === 'base64') {
      throw new Error(`${outputPath} is a folder. Pass --output with a file path for ${name}.`);
    }
    return;
  }
  const folder = await fs.stat(path.dirname(outputPath)).catch(() => null);
  if (outputPath.endsWith('/') || outputPath.endsWith(path.sep) || !folder?.isDirectory()) {
    throw new Error(
      `The folder for ${outputPath} does not exist. Create it, or pass --output with a path in a folder that exists.`
    );
  }
}

export function createHostActionUploadId(localPath: string): string {
  return `eas-cli-${randomUUID()}${path.extname(localPath).replace(/[^A-Za-z0-9.]/g, '')}`;
}

export async function uploadFileAsync(
  connection: HostActionConnection,
  localPath: string,
  { chunkBytes = UPLOAD_CHUNK_BYTES }: { chunkBytes?: number } = {}
): Promise<{ uploadId: string; path: string }> {
  const uploadId = createHostActionUploadId(localPath);
  let remotePath = '';
  let first = true;
  try {
    for await (const chunk of fs.createReadStream(localPath, { highWaterMark: chunkBytes })) {
      const result = await connection.requestAsync('upload.append', {
        uploadId,
        data: Buffer.from(chunk).toString('base64'),
        first,
      });
      if (result.exitCode !== 0) {
        throw new Error(`Could not upload ${localPath}: ${result.stderr.trim()}`);
      }
      remotePath = result.stdout.trim();
      first = false;
    }
  } catch (error) {
    await connection.requestAsync('upload.remove', { uploadId }).catch(() => {});
    throw error;
  }
  if (first) {
    throw new Error(`${localPath} is empty. Pass a file with content.`);
  }
  return { uploadId, path: remotePath };
}

export async function saveHostActionOutputAsync(
  connection: HostActionConnection,
  entry: HostActionCatalogEntry,
  stdout: string,
  outputPath: string | undefined
): Promise<string | null> {
  if (!entry.output) {
    return null;
  }
  let base64 = stdout;
  let defaultName: string | undefined;
  if (entry.output === 'path') {
    const remotePath = stdout.trim();
    const file = await connection.requestAsync('file.readBase64', { path: remotePath });
    if (file.exitCode !== 0) {
      throw new Error(`Could not download ${remotePath}: ${file.stderr.trim()}`);
    }
    base64 = file.stdout;
    defaultName = path.basename(remotePath);
  }
  const outputIsFolder = outputPath
    ? (await fs.stat(outputPath).catch(() => null))?.isDirectory()
    : false;
  const generatedName = outputIsFolder || !outputPath ? defaultName : undefined;
  const target = generatedName ? path.join(outputPath ?? '.', generatedName) : outputPath;
  if (!target) {
    throw new Error('Pass --output with a file path to save the file.');
  }
  try {
    await fs.writeFile(target, Buffer.from(base64, 'base64'), {
      flag: target === outputPath ? 'w' : 'wx',
    });
  } catch (error) {
    if (typeof error === 'object' && error !== null && 'code' in error && error.code === 'EEXIST') {
      throw new Error(`${target} already exists. Pass --output with a new path to save the file.`);
    }
    throw error;
  }
  return path.resolve(target);
}
