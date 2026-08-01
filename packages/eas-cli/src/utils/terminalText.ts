/**
 * Sanitize externally-influenced text for printing as a single-line field value. Escape
 * sequences in a crafted value could clear the screen or spoof output, and embedded newlines
 * could fake extra output lines, so control characters are stripped and whitespace runs
 * collapse to one space.
 */
// eslint-disable-next-line no-control-regex
const CONTROL_CHARACTERS = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F-\u009F]/g;

export function sanitizeTerminalText(value: string): string {
  return value.replace(CONTROL_CHARACTERS, '').replace(/\s+/g, ' ').trim();
}
