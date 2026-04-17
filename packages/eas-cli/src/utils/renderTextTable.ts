import chalk from 'chalk';

/**
 * Render a simple column-aligned text table with a bold header row, a dashed
 * separator, the data rows, and an optional footer row (preceded by its own
 * separator). Columns are padded to the widest cell in that column.
 */
export default function renderTextTable(
  headers: string[],
  rows: string[][],
  footerRow?: string[]
): string {
  const allRows = footerRow ? [...rows, footerRow] : rows;
  const colWidths = headers.map((h, i) =>
    Math.max(h.length, ...allRows.map(r => (r[i] ?? '').length))
  );
  const headerLine = headers.map((h, i) => h.padEnd(colWidths[i])).join('  ');
  const separatorLine = colWidths.map(w => '-'.repeat(w)).join('  ');
  const dataLines = rows.map(row =>
    row.map((cell, i) => (cell ?? '').padEnd(colWidths[i])).join('  ')
  );
  const lines = [chalk.bold(headerLine), separatorLine, ...dataLines];
  if (footerRow) {
    lines.push(separatorLine);
    lines.push(footerRow.map((cell, i) => (cell ?? '').padEnd(colWidths[i])).join('  '));
  }
  return lines.join('\n');
}
