import { Args, Flags } from '@oclif/core';
import chalk from 'chalk';

import {
  ChatMessage,
  makeAssistantMessage,
  makeUserMessage,
  streamChatResponseAsync,
} from '../chat/chatClient';
import { detectCurrentProjectAsync } from '../chat/detectProject';
import { ChatReplInput, createChatReplInput } from '../chat/replInput';
import EasCommand from '../commandUtils/EasCommand';
import { ExpoGraphqlClient } from '../commandUtils/context/contextUtils/createGraphqlClient';
import {
  EasNonInteractiveAndJsonFlags,
  resolveNonInteractiveAndJsonFlags,
} from '../commandUtils/flags';
import { AppQuery } from '../graphql/queries/AppQuery';
import Log from '../log';
import { Actor } from '../user/User';
import { enableJsonOutput, printJsonOnlyOutput } from '../utils/json';

const EXIT_WORDS = new Set(['exit', 'quit', 'q']);
const CHAT_HELP = [
  'Commands:',
  '  /help    Show this help',
  '  /clear   Start a new conversation',
  '  /exit    Quit',
].join('\n');

export default class Chat extends EasCommand {
  static override description = 'ask an AI assistant about your Expo account and EAS projects';

  static override hidden = true;

  static override args = {
    message: Args.string({
      required: true,
      description: 'Message to send to the assistant',
    }),
  };

  static override flags = {
    account: Flags.string({
      char: 'a',
      description: 'Account to scope the conversation to (defaults to your primary account)',
    }),
    project: Flags.string({
      char: 'p',
      description:
        'Project to focus the conversation on, as @account-name/project-slug or a project slug',
    }),
    ...EasNonInteractiveAndJsonFlags,
  };

  static override contextDefinition = {
    ...this.ContextOptions.LoggedIn,
  };

  async runAsync(): Promise<void> {
    const { args, flags } = await this.parse(Chat);
    const { json, nonInteractive } = resolveNonInteractiveAndJsonFlags(flags);
    if (json) {
      enableJsonOutput();
    }

    const {
      loggedIn: { actor, authenticationInfo, graphqlClient },
    } = await this.getContextAsync(Chat, { nonInteractive });

    if (!authenticationInfo.sessionSecret) {
      throw new Error(
        '`eas chat` requires an interactive login. Run `eas login` first. Chat does not support EXPO_TOKEN access tokens yet.'
      );
    }
    const { sessionSecret } = authenticationInfo;

    let accountName = flags.account ?? getDefaultAccountName(actor);
    let projectLabel: string | undefined;
    let projectDetectedFromDirectory = false;
    if (flags.project) {
      const resolved = await resolveProjectAsync(graphqlClient, flags.project, accountName);
      accountName = resolved.accountName;
      projectLabel = resolved.label;
    } else if (!flags.account) {
      // No explicit scope given: focus on the current directory's project when there is one.
      const detected = await detectCurrentProjectAsync(graphqlClient);
      if (detected) {
        accountName = detected.accountName;
        projectLabel = detected.label;
        projectDetectedFromDirectory = true;
      }
    }

    const firstMessageText = projectLabel
      ? `Regarding the EAS project ${projectLabel}: ${args.message}`
      : args.message;
    const messages: ChatMessage[] = [makeUserMessage(firstMessageText)];

    if (json) {
      const result = await streamChatResponseAsync({
        messages: [...messages],
        accountName,
        sessionSecret,
        stream: false,
      });
      printJsonOnlyOutput({
        message: args.message,
        account: accountName ?? null,
        project: projectLabel ?? null,
        response: result.text,
        toolCalls: result.toolCalls,
      });
      return;
    }

    if (projectLabel) {
      Log.log(
        chalk.dim(
          projectDetectedFromDirectory
            ? `Project: ${projectLabel} (from current directory; use --account to widen)`
            : `Project: ${projectLabel}`
        )
      );
    }
    Log.log(chalk.dim(`> ${args.message}`));
    if (!nonInteractive) {
      Log.log(chalk.dim('Type a message to continue. Use /help for commands, or /exit to quit.'));
    }
    Log.newLine();

    // Seed history with the message from the command line so Up recalls it at the first prompt.
    const input = nonInteractive ? undefined : createChatReplInput({ history: [args.message] });
    try {
      for (;;) {
        const result = await streamChatResponseAsync({
          messages: [...messages],
          accountName,
          sessionSecret,
          stream: true,
        });
        messages.push(makeAssistantMessage(result.text));

        if (!input) {
          break;
        }

        const nextMessage = await readNextUserMessageAsync(input, messages);
        if (nextMessage === null) {
          Log.log(chalk.dim('Ending chat.'));
          break;
        }
        messages.push(makeUserMessage(nextMessage));
      }
    } finally {
      input?.close();
    }
  }
}

/**
 * Prompts for the next message, handling slash commands. Returns the message text to send, or `null`
 * to end the chat. `messages` is mutated in place by conversation-affecting commands (e.g. /clear).
 */
async function readNextUserMessageAsync(
  input: ChatReplInput,
  messages: ChatMessage[]
): Promise<string | null> {
  for (;;) {
    Log.newLine();
    const line = await input.askAsync(`${chalk.bold.cyan('You')} ${chalk.dim('›')} `);
    if (line === null) {
      return null;
    }
    const trimmed = line.trim();
    if (!trimmed) {
      continue;
    }
    if (EXIT_WORDS.has(trimmed.toLowerCase())) {
      return null;
    }

    if (trimmed.startsWith('/')) {
      const command = trimmed.slice(1).split(/\s+/)[0].toLowerCase();
      if (['exit', 'quit', 'q'].includes(command)) {
        return null;
      }
      if (['clear', 'new', 'reset'].includes(command)) {
        messages.length = 0;
        Log.log(chalk.dim('Started a new conversation.'));
        continue;
      }
      if (['help', 'h', '?'].includes(command)) {
        Log.log(chalk.dim(CHAT_HELP));
        continue;
      }
      Log.warn(`Unknown command "/${command}". Type /help for commands.`);
      continue;
    }

    Log.newLine();
    return trimmed;
  }
}

function getDefaultAccountName(actor: Actor): string | undefined {
  if ('primaryAccount' in actor && actor.primaryAccount) {
    return actor.primaryAccount.name;
  }
  return actor.accounts[0]?.name ?? undefined;
}

async function resolveProjectAsync(
  graphqlClient: ExpoGraphqlClient,
  projectReference: string,
  fallbackAccountName: string | undefined
): Promise<{ accountName: string; label: string }> {
  const parsed = parseProjectReference(projectReference);
  const accountForLookup = parsed.account ?? fallbackAccountName;
  if (!accountForLookup) {
    throw new Error(
      `Could not determine which account owns project "${projectReference}". Pass it as @account-name/project-slug.`
    );
  }

  const fullName = `@${accountForLookup}/${parsed.slug}`;
  let app;
  try {
    app = await AppQuery.byFullNameAsync(graphqlClient, fullName);
  } catch {
    throw new Error(`Project ${fullName} was not found or you do not have access to it.`);
  }
  return { accountName: app.ownerAccount.name, label: app.fullName };
}

function parseProjectReference(reference: string): { account?: string; slug: string } {
  const cleaned = reference.startsWith('@') ? reference.slice(1) : reference;
  const parts = cleaned.split('/');
  if (parts.length === 2 && parts[0] && parts[1]) {
    return { account: parts[0], slug: parts[1] };
  }
  return { slug: cleaned };
}
