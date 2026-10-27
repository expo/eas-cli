/**
 * Formats a changeset summary as the text of a CHANGELOG list item.
 *
 * The summary must be one nonempty line. It is capitalized, ends with a period, and gets attribution.
 *
 * @param {string} summary The changeset summary.
 * @param {string} attribution For example `([#123](https://...) by [@user](https://...))`.
 * @returns {string} The entry text, without the leading `- `.
 */
export function formatEntry(summary, attribution) {
  const firstLine = validateSummary(summary);
  const capitalizedLine = `${firstLine[0].toUpperCase()}${firstLine.slice(1)}`;
  const sentence = capitalizedLine.endsWith('.') ? capitalizedLine : `${capitalizedLine}.`;
  return `${sentence} ${attribution}`;
}

/** @param {string} summary @returns {string} The trimmed, single-line summary. */
export function validateSummary(summary) {
  const trimmed = summary.trim();
  if (!trimmed || /[\r\n]/.test(trimmed)) {
    throw new Error(
      'The changeset body must contain exactly one nonempty line. Combine the summary into one line below the front matter.'
    );
  }
  return trimmed;
}
