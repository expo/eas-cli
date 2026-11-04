/**
 * Format a value so that `dotenv` reads the written `.env` line back unchanged.
 *
 * dotenv trims unquoted values, cuts them at the first `#`, and strips one layer of quotes.
 * Inside double quotes it unescapes only `\n` and `\r`, so a `"` or a `\` stays literal and
 * cannot be escaped away. See https://github.com/motdotla/dotenv#comments.
 */
export function formatEnvValue(value: string): string {
  // Quotes only matter when they wrap the whole value, since dotenv strips just the outer
  // pair; anything else is read back as written as long as there is nothing to trim or cut.
  if (value === value.trim() && !/[#\r\n]/.test(value) && !/^(['"`])[\s\S]*\1$/.test(value)) {
    return value;
  }

  // Double quotes are the readable form: they keep the value on a single line, because
  // dotenv turns the `\n` and `\r` escapes back into newlines. That only holds for values
  // that contain neither a `"` of their own nor a literal `\n`/`\r` sequence to preserve.
  if (!value.includes('"') && !/\\[nr]/.test(value)) {
    return `"${value.replace(/\n/g, '\\n').replace(/\r/g, '\\r')}"`;
  }

  // Single quotes and backticks are read back verbatim, so they carry the values double
  // quotes cannot, at the cost of writing newlines out as real line breaks.
  const quote = ["'", '`'].find(candidate => !value.includes(candidate));
  if (quote) {
    return `${quote}${value}${quote}`;
  }

  // A value using all three quote characters has no lossless representation. Escape it so
  // at least the rest of the file still parses and the value cannot define another key.
  return `"${value.replace(/"/g, '\\"').replace(/\n/g, '\\n').replace(/\r/g, '\\r')}"`;
}
