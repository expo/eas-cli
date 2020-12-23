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
  // This emulates the check that's performed on the ASC website's "apps"
  // page before presenting the (+) create app button.
  const status = await getContractStatusAsync(context);

  if (['FREE_APP_AGREEMENT_ACTIVE', 'PAID_APP_AGREEMENT_ACTIVE'].includes(status)) {
    // The user can freely create an app, no contracts need to be accepted.
    // No need to check for messages because afaict no vital messages will be present.
    return [];
  } else if (
    ['FREE_APP_AGREEMENT_OUTDATED', 'PAID_APP_AGREEMENT_OUTDATED', 'EXPIRED_MEMBERSHIP'].includes(
      status
    )
  ) {
    // The user cannot create an app until they've reviewed, and agreed to the updated agreements
    // or renewed their membership on ASC.
    // Get the exact messages from ASC to show the user a useful message.
    return (await getContractMessagesAsync(context)) ?? [];
  }
  // The contract messages aren't documented so if a new one is present we cannot be sure if it's fatal or not.
  // This will check for messages, if none exist, then the process will continue.
  // Otherwise messages will be present and the process will stop.
  // There is a small chance that this could result in a false positive if the messages are extraneous, so we'll also
  // prompt the user to open an issue so we can address the new contract state if it ever appears.
  // TODO: Maybe a silent analytic would be better
  log.error(
    `Unexpected Apple developer contract status "${status}". Please open an issue on https://github.com/expo/eas-cli`
  );
  return (await getContractMessagesAsync(context)) ?? [];
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
