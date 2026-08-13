import { type bunyan } from '@expo/logger';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { setTimeout as setTimeoutAsync } from 'node:timers/promises';
import { z } from 'zod';

import { type CustomBuildContext } from '../../customBuildContext';
import { turtleFetch } from '../../utils/turtleFetch';
import {
  type DeviceRunSessionEventCollection,
  type DeviceRunSessionEventSource,
  startDeviceRunSessionEventCollectionAsync,
} from './deviceRunSessionEvents';

const APPIUM_REQUEST_TIMEOUT_MS = 10_000;
const POLL_INTERVAL_MS = 1_000;
const GET_LOG_EVENTS_COMMAND = 'getLogEvents';

const AppiumSessionsResponseSchema = z.object({
  value: z.array(z.object({ id: z.string() }).passthrough()),
});

const AppiumCommandSchema = z.object({
  appiumSessionId: z.string(),
  cmd: z.string(),
  startTime: z.number(),
  endTime: z.number(),
});

const AppiumEventsResponseSchema = z.object({
  value: z.object({
    commands: z.array(AppiumCommandSchema.omit({ appiumSessionId: true })),
  }),
});

type AppiumCommand = z.infer<typeof AppiumCommandSchema>;

export async function startAppiumEventCollectionAsync({
  ctx,
  deviceRunSessionId,
  appiumUrl,
  logger,
  pollIntervalMs = POLL_INTERVAL_MS,
}: {
  ctx: CustomBuildContext;
  deviceRunSessionId: string;
  appiumUrl: string;
  logger: bunyan;
  pollIntervalMs?: number;
}): Promise<DeviceRunSessionEventCollection> {
  const eventDirectory = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'eas-appium-events-'));
  const eventFile = path.join(eventDirectory, 'commands.ndjson');
  await fs.promises.writeFile(eventFile, '');

  let eventCollection: DeviceRunSessionEventCollection;
  try {
    eventCollection = await startDeviceRunSessionEventCollectionAsync({
      ctx,
      deviceRunSessionId,
      logger,
      pollIntervalMs,
      source: createAppiumEventSource(eventFile),
    });
  } catch (error) {
    await fs.promises.rm(eventDirectory, { recursive: true, force: true });
    throw error;
  }

  const observedCommandKeys = new Set<string>();
  const controller = new AbortController();
  let didReportCollectionFailure = false;
  const collectSafelyAsync = async (): Promise<void> => {
    try {
      await collectAppiumCommandsAsync({
        appiumUrl,
        eventFile,
        observedCommandKeys,
        logger,
      });
      didReportCollectionFailure = false;
    } catch (error) {
      if (!didReportCollectionFailure) {
        didReportCollectionFailure = true;
        logger.warn({ err: error }, 'Could not collect Appium events.');
      }
    }
  };
  const pollingPromise = (async () => {
    while (!controller.signal.aborted) {
      await collectSafelyAsync();
      try {
        await setTimeoutAsync(pollIntervalMs, undefined, { signal: controller.signal });
      } catch (error) {
        if (!controller.signal.aborted) {
          throw error;
        }
      }
    }
  })().catch(error => {
    logger.warn({ err: error }, 'Appium event collection poller failed.');
  });

  return {
    getLastEventObservedAt: eventCollection.getLastEventObservedAt,
    stopAsync: async () => {
      controller.abort();
      await pollingPromise;
      await collectSafelyAsync();
      try {
        await eventCollection.stopAsync();
      } finally {
        await fs.promises.rm(eventDirectory, { recursive: true, force: true });
      }
    },
  };
}

function createAppiumEventSource(eventFile: string): DeviceRunSessionEventSource {
  return {
    producer: 'appium',
    findEventFilesAsync: async () => [eventFile],
    sourceKeyForFile: file => path.basename(file, path.extname(file)),
    parseLine: ({ line, sourceKey, sequenceNumber, deviceRunSessionId }) => {
      if (!line.trim()) {
        return {};
      }
      let parsed: unknown;
      try {
        parsed = JSON.parse(line);
      } catch {
        return { failure: 'invalid-json' };
      }
      const result = AppiumCommandSchema.safeParse(parsed);
      if (!result.success) {
        return { failure: 'invalid-event' };
      }
      const command = result.data;
      const operationId = `${sourceKey}:${sequenceNumber}`;
      return {
        event: {
          v: 1,
          eventId: `appium:${deviceRunSessionId}:${operationId}`,
          ts: new Date(command.endTime).toISOString(),
          producer: 'appium',
          type: 'operation.completed',
          operationId,
          durationMs: Math.max(0, command.endTime - command.startTime),
          summary: command.cmd,
          data: {
            command: command.cmd,
            appiumSessionId: command.appiumSessionId,
          },
        },
      };
    },
  };
}

async function collectAppiumCommandsAsync({
  appiumUrl,
  eventFile,
  observedCommandKeys,
  logger,
}: {
  appiumUrl: string;
  eventFile: string;
  observedCommandKeys: Set<string>;
  logger: bunyan;
}): Promise<void> {
  const response = await turtleFetch(new URL('sessions', appiumUrl).toString(), 'GET', {
    timeout: APPIUM_REQUEST_TIMEOUT_MS,
    retries: 0,
    logger,
  });
  const sessions = AppiumSessionsResponseSchema.parse(await response.json()).value;
  const newCommands: { key: string; command: AppiumCommand }[] = [];
  const pendingCommandKeys = new Set<string>();

  for (const { id: appiumSessionId } of sessions) {
    const eventsResponse = await turtleFetch(
      new URL(`session/${encodeURIComponent(appiumSessionId)}/appium/events`, appiumUrl).toString(),
      'POST',
      {
        json: {},
        timeout: APPIUM_REQUEST_TIMEOUT_MS,
        retries: 0,
        logger,
      }
    );
    const commands = AppiumEventsResponseSchema.parse(await eventsResponse.json()).value.commands;
    for (const command of commands) {
      const key = [appiumSessionId, command.cmd, command.startTime, command.endTime].join(':');
      if (
        command.cmd === GET_LOG_EVENTS_COMMAND ||
        observedCommandKeys.has(key) ||
        pendingCommandKeys.has(key)
      ) {
        continue;
      }
      pendingCommandKeys.add(key);
      newCommands.push({ key, command: { appiumSessionId, ...command } });
    }
  }

  if (newCommands.length === 0) {
    return;
  }
  await fs.promises.appendFile(
    eventFile,
    `${newCommands.map(({ command }) => JSON.stringify(command)).join('\n')}\n`
  );
  for (const { key } of newCommands) {
    observedCommandKeys.add(key);
  }
}
