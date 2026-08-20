import spawnAsync from '@expo/spawn-async';
import { Flags } from '@oclif/core';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import EasCommand from '../../commandUtils/EasCommand';
import { ExpoGraphqlClient } from '../../commandUtils/context/contextUtils/createGraphqlClient';
import {
  WorkflowJobSshConnectInfo,
  WorkflowJobSshQuery,
  WorkflowJobSshSession,
} from '../../graphql/queries/WorkflowJobSshQuery';
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
    | (Pick<WorkflowJobSshConnectInfo, 'sshRequested' | 'jobCompleted'> & {
        session?: Pick<WorkflowJobSshSession, 'connectionConfig'> | null;
      })
    | null
): SshConnectStatus {
  if (!connectInfo) {
    return 'unknown';
  }
  const { sshRequested, jobCompleted, session } = connectInfo;
  if (session?.connectionConfig && !session.connectionConfig.reconnecting) {
    return 'ready';
  }
  if (session?.connectionConfig?.reconnecting) {
    return 'pending';
  }
  if (!sshRequested) {
    return 'not-enabled';
  }
  return jobCompleted ? 'ended' : 'pending';
}

export function terminalSshStatusMessage(
  status: SshConnectStatus,
  resourceId: string
): string | null {
  switch (status) {
    case 'unknown':
      return `No workflow job found for "${resourceId}". Pass a workflow job id from a run started with \`eas workflow:run --ssh\`.`;
    case 'not-enabled':
      return `SSH was not enabled for "${resourceId}". Start the run with \`eas workflow:run --ssh\` to enable it.`;
    case 'ended':
      return 'This ssh session has ended.';
    case 'pending':
    case 'ready':
      return null;
  }
}

export function sshHostAliasForResource(resourceId: string): string {
  const suffix = resourceId.replace(/[^A-Za-z0-9]/g, '').slice(0, 8);
  return suffix ? `eas-workflow-ssh-${suffix}` : 'eas-workflow-ssh';
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
      throw new Error('Provide a workflow job id: eas workflow:ssh <workflow-job-id> [command...]');
    }

    const {
      loggedIn: { graphqlClient },
    } = await this.getContextAsync(WorkflowSsh, { nonInteractive: true });

    const connectInfo = await WorkflowJobSshQuery.connectInfoForWorkflowJobAsync(
      graphqlClient,
      resourceId
    );
    const status = resolveSshConnectStatus(connectInfo);
    const statusMessage = terminalSshStatusMessage(status, resourceId);
    if (statusMessage) {
      Log.error(statusMessage);
      process.exitCode = 1;
      return;
    }

    const connectionConfig =
      (status === 'ready' ? connectInfo?.session?.connectionConfig : null) ??
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
      // WSS terminates on the relay hostname (default 443). Do not paste an SSH
      // :port into the wss:// URL — that port is only for the ssh destination.
      Log.log(
        `  ssh -o ProxyCommand="upterm proxy wss://${secret}@${host}" ${SSH_INSECURE_OPTS}${portOption} ${secret}@${host}`
      );
      return;
    }

    const configDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'eas-workflow-ssh-'));
    try {
      const configPath = path.join(configDir, 'config');
      const hostAlias = sshHostAliasForResource(resourceId);
      await fs.promises.writeFile(
        configPath,
        [
          `Host ${hostAlias}`,
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
      await spawnAsync('ssh', ['-F', configPath, hostAlias, ...command], {
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
  workflowJobId: string
): Promise<NonNullable<WorkflowJobSshSession['connectionConfig']> | null> {
  const spinner = ora('Waiting for the worker to open the ssh session').start();
  const deadline = Date.now() + SESSION_OPEN_TIMEOUT_MS;
  try {
    while (Date.now() < deadline) {
      const connectInfo = await WorkflowJobSshQuery.connectInfoForWorkflowJobAsync(
        graphqlClient,
        workflowJobId
      );
      const status = resolveSshConnectStatus(connectInfo);
      const statusMessage = terminalSshStatusMessage(status, workflowJobId);
      if (statusMessage) {
        spinner.fail(statusMessage);
        return null;
      }
      if (status === 'ready') {
        spinner.succeed('The ssh session is ready.');
        return connectInfo?.session?.connectionConfig ?? null;
      }
      await sleepAsync(SESSION_OPEN_POLL_INTERVAL_MS);
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
