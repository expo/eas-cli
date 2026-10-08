/**
 * Formats a changeset summary as the text of a CHANGELOG list item.
 *
 * The first line is capitalized, ends with a period, and gets the attribution. Later lines are
 * indented by two spaces, so they stay inside the list item.
 *
 * @param {string} summary The changeset summary.
 * @param {string} attribution For example `([#123](https://...) by [@user](https://...))`.
 * @returns {string} The entry text, without the leading `- `.
 */
export function formatEntry(summary, attribution) {
  const [firstLine, ...otherLines] = summary
    .trim()
    .split('\n')
    .map(line => line.trimEnd());
  if (!firstLine) {
    throw new Error('The changeset summary is empty. Describe the change below the front matter.');
  }
  const capitalizedLine = `${firstLine[0].toUpperCase()}${firstLine.slice(1)}`;
  const sentence = capitalizedLine.endsWith('.') ? capitalizedLine : `${capitalizedLine}.`;
  const indentedLines = otherLines.map(line => (line ? `  ${line}` : ''));
  return [`${sentence} ${attribution}`, ...indentedLines].join('\n');
}
