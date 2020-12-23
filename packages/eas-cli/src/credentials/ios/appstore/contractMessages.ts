import { ITCAgreements, RequestContext } from '@expo/apple-utils';
import chalk from 'chalk';
import { Ora } from 'ora';

import log from '../../../log';
import { convertHTMLToASCII } from '../utils/convertHTMLToASCII';

async function getContractStatusAsync(
  context: RequestContext
): Promise<ITCAgreements.ITCContractStatus | null> {
  try {
    const capabilities = await ITCAgreements.getCapabilitiesAsync(context);
    return capabilities?.contractStatus ?? null;
  } catch (error) {
    log.warn(`Failed to get iTunes contract status: ${error.message}`);
    return null;
  }
}

async function getContractMessagesAsync(context: RequestContext) {
  try {
    return await ITCAgreements.getContractMessagesAsync(context);
  } catch (error) {
    log.warn(`Failed to get iTunes contract messages: ${error.message}`);
    return null;
  }
}

async function getRequiredContractMessagesAsync(context: RequestContext) {
  const status = await getContractStatusAsync(context);

  switch (status) {
    // The user can freely create an app
    case 'FREE_APP_AGREEMENT_ACTIVE':
    case 'PAID_APP_AGREEMENT_ACTIVE':
      return false;
    // The user cannot create an app until they've resolved contract issues on ASC.
    case 'FREE_APP_AGREEMENT_OUTDATED':
    case 'PAID_APP_AGREEMENT_OUTDATED':
    case 'EXPIRED_MEMBERSHIP':
      return (await getContractMessagesAsync(context)) ?? [];
    default:
      // TODO: Maybe a silent analytic would be better
      log.warn(
        `Unknown Apple developer contract status "${status}". Please open an issue on https://github.com/expo/eas-cli`
      );
      return (await getContractMessagesAsync(context)) ?? [];
  }
}

const rootUrl = 'https://appstoreconnect.apple.com';

export function formatContractMessage(message: ITCAgreements.ITCContractMessage): string {
  return convertHTMLToASCII({
    content:
      '\u203A ' +
      [message.subject && `<b>${message.subject}</b>`, message.message]
        .filter(Boolean)
        .join('<br />'),
    rootUrl,
  });
}

export async function assertContractMessagesAsync(context: RequestContext, spinner?: Ora) {
  const messages = await getRequiredContractMessagesAsync(context);

  if (Array.isArray(messages) && messages.length) {
    if (spinner) {
      spinner.stop();
    }
    log.newLine();
    log(chalk.yellow.bold('Messages from App Store Connect:'));
    log.newLine();
    for (const message of messages) {
      if (log.isDebug) {
        log(JSON.stringify(message, null, 2));
        log.newLine();
      }
      log.addNewLineIfNone();
      log(formatContractMessage(message));
    }
    log.addNewLineIfNone();
    throw new Error('App Store Connect has agreement updates that must be resolved');
  }
}
