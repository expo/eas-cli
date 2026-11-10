/**
 * Other topic names that run `eas simulator:*` commands, for example `eas sim:start` or
 * `eas emulators:list`. Help and the README list the `sim` aliases. The other aliases are
 * hidden, so that help lists each command at most twice.
 */
export const SIMULATOR_TOPIC_ALIASES = ['sim'];
export const SIMULATOR_HIDDEN_TOPIC_ALIASES = ['simulators', 'emulator', 'emulators'];

export function getSimulatorCommandAliases(name: string): string[] {
  return SIMULATOR_TOPIC_ALIASES.map(topic => `${topic}:${name}`);
}

export function getSimulatorCommandHiddenAliases(name: string): string[] {
  return SIMULATOR_HIDDEN_TOPIC_ALIASES.map(topic => `${topic}:${name}`);
}

export function isSimulatorCommandId(id: string | undefined, name: string): boolean {
  return (
    id === `simulator:${name}` ||
    (id !== undefined &&
      [...getSimulatorCommandAliases(name), ...getSimulatorCommandHiddenAliases(name)].includes(id))
  );
}
