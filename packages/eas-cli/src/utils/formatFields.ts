import chalk from 'chalk';

export default function formatFields(fields: { label: string; value: string }[]) {
  const columnWidth = fields.reduce((a, b) => (a.label.length > b.label.length ? a : b)).label
    .length;

  return fields
    .map(({ label, value }) => {
      let line = '';

      line += chalk.dim(
        label.length < columnWidth ? `${label}${' '.repeat(columnWidth - label.length)}` : label
      );

      line += '  ';
      line += value;

      return line;
    })
    .join('\n');
}
