/**
 * Makes child processes and nested EAS commands report `command` as their parent command.
 * Expo CLI uses the same variable name and the same `<cli> <command>` value. Do not change them.
 *
 * `parentCommand` is the Expo CLI or EAS CLI command that started the current one.
 * `restoreParentCommand` puts the inherited value back.
 */
export function markAsParentCommand(command: string): {
  parentCommand: string | null;
  restoreParentCommand: () => void;
} {
  const inheritedCommand = process.env.__EXPO_PARENT_COMMAND;
  process.env.__EXPO_PARENT_COMMAND = command;

  return {
    parentCommand: inheritedCommand || null,
    restoreParentCommand: () => {
      if (inheritedCommand === undefined) {
        delete process.env.__EXPO_PARENT_COMMAND;
      } else {
        process.env.__EXPO_PARENT_COMMAND = inheritedCommand;
      }
    },
  };
}
