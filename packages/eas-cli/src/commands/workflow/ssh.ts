import spawnAsync from '@expo/spawn-async';
import { Flags } from '@oclif/core';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import EasCommand from '../../commandUtils/EasCommand';
import { ExpoGraphqlClient } from '../../commandUtils/context/contextUtils/createGraphqlClient';
import {
  TurtleSshConnectInfo,
  TurtleSshSession,
  TurtleSshSessionQuery,
} from '../../graphql/queries/TurtleSshSessionQuery';
import Log from '../../log';
import { ora } from '../../ora';
import { sleepAsync } from '../../utils/promise';

export const CONNECTION_HOST_REGEX = /^[A-Za-z0-9.-]+(?::\d+)?$/;
export const CONNECTION_SECRET_REGEX = /^[A-Za-z0-9._~:/+=-]+$/;

export function splitConnectionHost(connectionHost: string): { host: string; port?: number } {
  const match = connectionHost.match(/^(.+):(\d+)$/);
  if (!match) {
    return { host: connectionHost };
  }
  return { host: match[1], port: Number(match[2]) };
}

const SSH_INSECURE_OPTS = '-o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null';

const SESSION_OPEN_TIMEOUT_MS = 5 * 60 * 1000;
const SESSION_OPEN_POLL_INTERVAL_MS = 3000;

export type SshConnectStatus = 'unknown' | 'not-enabled' | 'ended' | 'pending' | 'ready';

export function resolveSshConnectStatus(
  connectInfo:
    | (Pick<TurtleSshConnectInfo, 'sshRequested' | 'jobCompleted'> & {
        session?: Pick<TurtleSshSession, 'connectionConfig'> | null;
      })
    | null
): SshConnectStatus {
  if (!connectInfo) {
    return 'unknown';
  }
  const { sshRequested, jobCompleted, session } = connectInfo;
  if (session) {
    return session.connectionConfig ? 'ready' : 'ended';
  }
  if (!sshRequested) {
    return 'not-enabled';
  }
  return jobCompleted ? 'ended' : 'pending';
}

export function parseSshArgv(rawArgv: readonly string[]): {
  showConnect: boolean;
  resourceId: string | undefined;
  command: string[];
} {
  let showConnect = false;
  let index = 0;
  while (index < rawArgv.length && rawArgv[index].startsWith('-')) {
    if (rawArgv[index] === '--show-connect' || rawArgv[index] === '--show-connect=true') {
      showConnect = true;
    } else {
      throw new Error(
        `Unknown flag "${rawArgv[index]}" before the id. The only supported flag is --show-connect; everything after the id is passed to the remote shell.`
      );
    }
    index += 1;
  }
  const [resourceId, ...command] = rawArgv.slice(index);
  return { showConnect, resourceId, command };
}

export default class WorkflowSsh extends EasCommand {
  static override hidden = true;

  static override description =
    '[EXPERIMENTAL] open an ssh session on the worker running a workflow job';

  static override strict = false;

  static override flags = {
    'show-connect': Flags.boolean({
      description: 'Print the ssh connection command (host and token) instead of opening a session',
      default: false,
    }),
  };

  static override contextDefinition = {
    ...this.ContextOptions.LoggedIn,
  };

  private isRunningSubprocess = false;

  async runAsync(): Promise<void> {
    const rawArgv = [...this.argv];
    await this.parse(WorkflowSsh, []);
    const { showConnect, resourceId, command } = parseSshArgv(rawArgv);

    if (typeof resourceId !== 'string' || resourceId.length === 0) {
      throw new Error(
        'Provide a workflow job, job run, or build id: eas workflow:ssh <id> [command...]'
      );
    }

    const {
      loggedIn: { graphqlClient },
    } = await this.getContextAsync(WorkflowSsh, { nonInteractive: true });

    const connectInfo = await TurtleSshSessionQuery.connectInfoForResourceAsync(
      graphqlClient,
      resourceId
    );
    const status = resolveSshConnectStatus(connectInfo);
    if (status === 'unknown') {
      Log.error(
        `No workflow job, job run, or build found for "${resourceId}". Pass an id from a run started with \`eas workflow:run --ssh\`.`
      );
      process.exitCode = 1;
      return;
    }
    if (status === 'not-enabled') {
      Log.error(
        `SSH was not enabled for "${resourceId}". Start the run with \`eas workflow:run --ssh\` to enable it.`
      );
      process.exitCode = 1;
      return;
    }
    if (status === 'ended') {
      Log.error('This ssh session has ended.');
      process.exitCode = 1;
      return;
    }

    const connectionConfig =
      connectInfo?.session?.connectionConfig ??
      (await waitForSessionToOpenAsync(graphqlClient, resourceId));
    if (!connectionConfig) {
      process.exitCode = 1;
      return;
    }

    const { host: connectionHost, secret } = connectionConfig;
    if (!CONNECTION_HOST_REGEX.test(connectionHost)) {
      throw new Error(
        'Unexpected connection host reported for this ssh session. Update eas-cli and try again, or contact support if it persists.'
      );
    }
    if (!CONNECTION_SECRET_REGEX.test(secret)) {
      throw new Error(
        'Unexpected connection token reported for this ssh session. Update eas-cli and try again, or contact support if it persists.'
      );
    }

    const { host, port } = splitConnectionHost(connectionHost);
    const portOption = port !== undefined ? ` -p ${port}` : '';

    if (showConnect) {
      Log.log(`ssh ${SSH_INSECURE_OPTS}${portOption} ${secret}@${host}`);
      Log.newLine();
      Log.log(
        'If your network blocks the direct SSH connection, reach the session through the WebSocket relay with upterm (https://upterm.dev):'
      );
      Log.log(
        `  ssh -o ProxyCommand="upterm proxy wss://${secret}@${connectionHost}" ${SSH_INSECURE_OPTS} ${secret}@${connectionHost}`
      );
      return;
    }

    const configDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'eas-workflow-ssh-'));
    try {
      const configPath = path.join(configDir, 'config');
      await fs.promises.writeFile(
        configPath,
        [
          'Host eas-workflow-ssh',
          `  HostName ${host}`,
          ...(port !== undefined ? [`  Port ${port}`] : []),
          `  User ${secret}`,
          '  StrictHostKeyChecking no',
          '  UserKnownHostsFile /dev/null',
          '',
        ].join('\n'),
        { mode: 0o600 }
      );

      this.isRunningSubprocess = true;
      await spawnAsync('ssh', ['-F', configPath, 'eas-workflow-ssh', ...command], {
        stdio: 'inherit',
      });
    } finally {
      await fs.promises.rm(configDir, { recursive: true, force: true });
    }
  }

  protected override catch(err: Error): Promise<void> {
    if (this.isRunningSubprocess) {
      if ((err as Error & { code?: string }).code === 'ENOENT') {
        Log.error(
          'Could not run `ssh`. Install an OpenSSH client and make sure `ssh` is on your PATH, then try again.'
        );
        process.exitCode = 1;
        return Promise.resolve();
      }
      const status = (err as Error & { status?: number | null }).status;
      process.exitCode = process.exitCode ?? status ?? 1;
      return Promise.resolve();
    }
    return super.catch(err);
  }
}

async function waitForSessionToOpenAsync(
  graphqlClient: ExpoGraphqlClient,
  resourceId: string
): Promise<NonNullable<TurtleSshSession['connectionConfig']> | null> {
  const spinner = ora('Waiting for the worker to open the ssh session').start();
  const deadline = Date.now() + SESSION_OPEN_TIMEOUT_MS;
  try {
    while (Date.now() < deadline) {
      await sleepAsync(SESSION_OPEN_POLL_INTERVAL_MS);
      const connectInfo = await TurtleSshSessionQuery.connectInfoForResourceAsync(
        graphqlClient,
        resourceId
      );
      const status = resolveSshConnectStatus(connectInfo);
      if (status === 'unknown' || status === 'not-enabled' || status === 'ended') {
        spinner.fail('The ssh session ended before it opened.');
        return null;
      }
      if (status === 'ready') {
        spinner.succeed('The ssh session is ready.');
        return connectInfo?.session?.connectionConfig ?? null;
      }
    }
    spinner.fail(
      'Timed out waiting for the ssh session to open. The worker may still be starting up; try again in a moment.'
    );
    return null;
  } catch (err) {
    spinner.stop();
    throw err;
  }
}
