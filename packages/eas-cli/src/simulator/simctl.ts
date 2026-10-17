export type SimctlHostAction = {
  action: string;
  params: Record<string, unknown>;
};

const SPRINGBOARD_RESTART_ARGS = [
  'spawn',
  'launchctl',
  'kickstart',
  '-k',
  'system/com.apple.SpringBoard',
];

export const SUPPORTED_SIMCTL_COMMANDS = [
  'ui appearance <light|dark>',
  SPRINGBOARD_RESTART_ARGS.join(' '),
];

export function resolveSimctlHostAction(args: string[]): SimctlHostAction | null {
  if (args.length === 3 && args[0] === 'ui' && args[1] === 'appearance') {
    const value = args[2];
    if (value === 'light' || value === 'dark') {
      return { action: 'appearance.set', params: { value } };
    }
    return null;
  }
  if (
    args.length === SPRINGBOARD_RESTART_ARGS.length &&
    args.every((arg, index) => arg === SPRINGBOARD_RESTART_ARGS[index])
  ) {
    return { action: 'springboard.restart', params: {} };
  }
  return null;
}
