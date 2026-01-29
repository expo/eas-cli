import { BuildFunction, BuildStepInput, BuildStepInputValueTypeName } from '@expo/steps';
import fetch, { Response } from 'node-fetch';
import { bunyan } from '@expo/logger';

export function createSendSlackMessageFunction(): BuildFunction {
  return new BuildFunction({
    namespace: 'eas',
    id: 'send_slack_message',
    name: 'Send Slack message',
    __metricsId: 'eas/send_slack_message',
    inputProviders: [
      BuildStepInput.createProvider({
        id: 'message',
        allowedValueTypeName: BuildStepInputValueTypeName.STRING,
        required: false,
      }),
      BuildStepInput.createProvider({
        id: 'payload',
        allowedValueTypeName: BuildStepInputValueTypeName.JSON,
        required: false,
      }),
      BuildStepInput.createProvider({
        id: 'slack_hook_url',
        allowedValueTypeName: BuildStepInputValueTypeName.STRING,
        required: false,
      }),
    ],
    fn: async (stepCtx, { inputs, env }) => {
      const { logger } = stepCtx;
      const slackMessage = inputs.message.value as string;
      const slackPayload = inputs.payload.value as object;
      if (!slackMessage && !slackPayload) {
        throw new Error(
          'You need to provide either "message" input or "payload" input to specify the Slack message contents'
        );
      }
      if (slackMessage && slackPayload) {
        throw new Error(
          'You cannot specify both "message" input and "payload" input - choose one for the Slack message contents'
        );
      }
      const slackHookUrl = (inputs.slack_hook_url.value as string) ?? env.SLACK_HOOK_URL;
      if (!slackHookUrl) {
        logger.warn(
          'Slack webhook URL not provided - provide input "slack_hook_url" or set "SLACK_HOOK_URL" secret'
        );
        throw new Error(
          'Sending Slack message failed - provide input "slack_hook_url" or set "SLACK_HOOK_URL" secret'
        );
      }
      await sendSlackMessageAsync({ logger, slackHookUrl, slackMessage, slackPayload });
    },
  });
}

async function sendSlackMessageAsync({
  logger,
  slackHookUrl,
  slackMessage,
  slackPayload,
}: {
  logger: bunyan;
  slackHookUrl: string;
  slackMessage: string | undefined;
  slackPayload: object | undefined;
}): Promise<void> {
  logger.info('Sending Slack message');

  const body = slackPayload ? slackPayload : { text: slackMessage };
  let fetchResult: Response;
  try {
    fetchResult = await fetch(slackHookUrl, {
      method: 'POST',
      body: JSON.stringify(body),
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (error) {
    logger.debug(error);
    throw new Error(`Sending Slack message to webhook url "${slackHookUrl}" failed`);
  }
  if (!fetchResult.ok) {
    logger.debug(`${fetchResult.status} - ${fetchResult.statusText}`);
    throw new Error(
      `Sending Slack message to webhook url "${slackHookUrl}" failed with status ${fetchResult.status}`
    );
  }
  logger.info('Slack message sent successfully');
}
