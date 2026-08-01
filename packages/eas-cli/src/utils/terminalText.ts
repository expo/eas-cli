/**
 * Strip terminal control characters from externally-influenced text before printing it. Escape
 * sequences in a crafted value could clear the screen or spoof output. Newlines and tabs survive
 * because multi-line values need them.
 */
// eslint-disable-next-line no-control-regex
const CONTROL_CHARACTERS = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F-\u009F]/g;

export function sanitizeTerminalText(value: string): string {
  return value.replace(/\r\n?/g, '\n').replace(CONTROL_CHARACTERS, '');
}
