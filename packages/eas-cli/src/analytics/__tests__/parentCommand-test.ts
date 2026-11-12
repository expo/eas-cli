import { markAsParentCommand } from '../parentCommand';

const originalParentCommand = process.env.EXPO_PARENT_COMMAND;

function setInheritedCommand(inheritedCommand: string | undefined): void {
  if (inheritedCommand === undefined) {
    delete process.env.EXPO_PARENT_COMMAND;
  } else {
    process.env.EXPO_PARENT_COMMAND = inheritedCommand;
  }
}

afterEach(() => {
  setInheritedCommand(originalParentCommand);
});

it.each(['expo run:ios', 'eas build', 'eas update:roll-back-to-embedded'])(
  'returns the inherited parent command %p',
  command => {
    setInheritedCommand(command);

    expect(markAsParentCommand('eas build').parentCommand).toBe(command);
  }
);

it.each([undefined, '', 'npm install', 'eas build --profile production', '/usr/bin/expo start'])(
  'drops the inherited value %p',
  value => {
    setInheritedCommand(value);

    expect(markAsParentCommand('eas build').parentCommand).toBeNull();
  }
);

it.each([undefined, '', 'expo run:ios'])(
  'marks the command until the inherited value %p is restored',
  inheritedCommand => {
    setInheritedCommand(inheritedCommand);

    const { restoreParentCommand } = markAsParentCommand('eas build');
    expect(process.env.EXPO_PARENT_COMMAND).toBe('eas build');

    restoreParentCommand();
    expect(process.env.EXPO_PARENT_COMMAND).toBe(inheritedCommand);
  }
);
