import chalk from 'chalk';

type FormatFieldsOptions = {
  labelFormat: (raw: string) => string;
};

export type FormatFieldsItem = { label: string; value: string };

export default function formatFields(
  fields: FormatFieldsItem[],
  options: FormatFieldsOptions = { labelFormat: chalk.dim }
): string {
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
