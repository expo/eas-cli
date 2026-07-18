import { getAgentTelemetryContext } from '../analytics/agent';
import { isNonInteractiveByDefault } from './flags';

export function printAgentFeedbackIfNeeded(
  commandId: string | undefined,
  argv: readonly string[]
): void {
  const isNonInteractive =
    isNonInteractiveByDefault() || argv.includes('--non-interactive') || argv.includes('--json');

  if (!isNonInteractive || !getAgentTelemetryContext()) {
    return;
  }

  process.stderr.write(
    `\nEAS CLI issue? Report it: npx --yes submit-expo-feedback --category eas-cli --subject "${
      commandId ?? 'unknown'
    }" "<what happened and how to reproduce>"\n`
  );
}
