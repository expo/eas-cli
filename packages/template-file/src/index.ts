import fs from 'fs/promises';

// We can't use lodash/template because templates expect to be able to do `_.forEach`.
import _ from 'lodash';

export function templateString({
  input,
  vars,
  mustache = true,
}: {
  input: string;
  vars: Record<string, unknown>;
  mustache?: boolean;
}): string {
  const compiledTemplate = _.template(
    input,
    mustache
      ? {
          interpolate: /{{([\s\S]+?)}}/g,
        }
      : undefined
  );
  return compiledTemplate(vars);
}

export async function templateFile(
  templateFilePath: string,
  vars: Record<string, unknown>,
  outputFilePath?: string,
  options: { mustache?: boolean } = {}
): Promise<string | void> {
  const templateContent = await fs.readFile(templateFilePath, 'utf8');
  const outputFileContents = templateString({ input: templateContent, vars, ...options });

  if (outputFilePath) {
    await fs.writeFile(outputFilePath, outputFileContents);
  } else {
    return outputFileContents;
  }
}

export default templateFile;
