import { detectSandbox } from 'sandbox-cli-detector';

import Log from '../log';

type SandboxTelemetryContext = string | null;

let sandboxTelemetryContext: SandboxTelemetryContext | undefined;

export function getSandboxTelemetryContext(): SandboxTelemetryContext {
  if (sandboxTelemetryContext === undefined) {
    sandboxTelemetryContext = resolveSandboxTelemetryContext();
  }

  return sandboxTelemetryContext;
}

function resolveSandboxTelemetryContext(): SandboxTelemetryContext {
  try {
    const { detected, sandbox } = detectSandbox();
    if (!detected || sandbox == null) {
      return null;
    }

    return sandbox.id;
  } catch (error: any) {
    Log.debug('Failed to detect sandbox:', error?.message ?? error);
    return null;
  }
}
