import chalk from 'chalk';

type FormatFieldsOptions = {
  labelFormat: (raw: string) => string;
};

export default function formatFields(
  fields: { label: string; value: string }[],
  options: FormatFieldsOptions = { labelFormat: chalk.dim }
) {
  const columnWidth = fields.reduce((a, b) => (a.label.length > b.label.length ? a : b)).label
    .length;

  return fields
    .map(({ label, value }) => {
      // make all labels fixed-width
      const formattedLabel = options.labelFormat(
        label.length < columnWidth ? `${label}${' '.repeat(columnWidth - label.length)}` : label
      );

      return `${formattedLabel}  ${value}`;
    })
    .join('\n');
}
