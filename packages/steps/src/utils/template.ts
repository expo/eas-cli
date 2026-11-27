import cloneDeep from 'lodash.clonedeep';

import { get } from './get';
import { BuildStepInputValueTypeName } from '../BuildStepInput';
import { BuildConfigError, BuildStepRuntimeError } from '../errors';

export const BUILD_STEP_INPUT_EXPRESSION_REGEXP = /\${\s*(inputs\.[\S]+)\s*}/;
export const BUILD_STEP_OUTPUT_EXPRESSION_REGEXP = /\${\s*(steps\.[\S]+)\s*}/;
export const BUILD_GLOBAL_CONTEXT_EXPRESSION_REGEXP = /\${\s*(eas\.[\S]+)\s*}/;
export const BUILD_STEP_OR_BUILD_GLOBAL_CONTEXT_REFERENCE_REGEX = /\${\s*((steps|eas)\.[\S]+)\s*}/;

type PlaceholderResolver = (expression: string) => string;

export interface TemplateInterpolation {
  regex: RegExp;
  resolve: PlaceholderResolver | undefined;
}

interface TemplatePart {
  text: string;
  isResolvedValue: boolean;
}

export function interpolateTemplate(
  template: string,
  interpolations: TemplateInterpolation[]
): string {
  let parts: TemplatePart[] = [{ text: template, isResolvedValue: false }];
  for (const { regex, resolve } of interpolations) {
    if (!resolve) {
      continue;
    }
    parts = parts.flatMap(part =>
      part.isResolvedValue ? [part] : resolvePlaceholders(part.text, regex, resolve)
    );
  }
  return parts.map(part => part.text).join('');
}

function resolvePlaceholders(
  text: string,
  regex: RegExp,
  resolve: PlaceholderResolver
): TemplatePart[] {
  const parts: TemplatePart[] = [];
  let textStart = 0;
  for (const match of text.matchAll(new RegExp(regex, 'g'))) {
    parts.push(
      { text: text.slice(textStart, match.index), isResolvedValue: false },
      { text: resolve(match[1]), isResolvedValue: true }
    );
    textStart = match.index + match[0].length;
  }
  parts.push({ text: text.slice(textStart), isResolvedValue: false });
  return parts;
}

export function getObjectValueForInterpolation(
  path: string,
  obj: Record<string, unknown>
): string | number | boolean | null {
  const value = get(obj, path);

  if (value === undefined) {
    throw new BuildStepRuntimeError(
      `Object field "${path}" does not exist. Ensure you are using the correct field name.`
    );
  }

  if (!isAllowedValueTypeForObjectInterpolation(value)) {
    throw new BuildStepRuntimeError(
      `EAS context field "${path}" is not of type ${Object.values(BuildStepInputValueTypeName).join(
        ', '
      )}, or undefined. It is of type "${typeof value}". We currently only support accessing string or undefined values from the EAS context.`
    );
  }

  if (value !== null && typeof value === 'object') {
    return JSON.stringify(value);
  }

  return value;
}

export function interpolateWithGlobalContext<InterpolableType extends string | object>(
  interpolableValue: InterpolableType,
  fn: (path: string) => string
): InterpolableType {
  if (typeof interpolableValue === 'string') {
    return interpolateStringWithGlobalContext(interpolableValue, fn) as InterpolableType;
  } else {
    return interpolateObjectWithGlobalContext(interpolableValue, fn) as InterpolableType;
  }
}

export function interpolateStringWithGlobalContext(
  templateString: string,
  fn: (path: string) => string
): string {
  return interpolateTemplate(templateString, [
    { regex: BUILD_GLOBAL_CONTEXT_EXPRESSION_REGEXP, resolve: fn },
  ]);
}

export function interpolateObjectWithGlobalContext(
  templateObject: object,
  fn: (path: string) => string
): object {
  const templateObjectCopy = cloneDeep(templateObject);
  Object.keys(templateObject).forEach(property => {
    const propertyValue = templateObject[property as keyof typeof templateObject];
    if (['string', 'object'].includes(typeof propertyValue)) {
      templateObjectCopy[property as keyof typeof templateObjectCopy] =
        interpolateWithGlobalContext(propertyValue, fn);
    }
  });
  return templateObjectCopy;
}

function isAllowedValueTypeForObjectInterpolation(
  value: unknown
): value is string | number | boolean | object | null {
  return (
    typeof value === 'string' ||
    typeof value === 'number' ||
    typeof value === 'boolean' ||
    typeof value === 'object' ||
    value === null
  );
}

interface BuildOutputPath {
  stepId: string;
  outputId: string;
}

export function findOutputPaths(templateString: string): BuildOutputPath[] {
  const result: BuildOutputPath[] = [];
  const matches = templateString.matchAll(new RegExp(BUILD_STEP_OUTPUT_EXPRESSION_REGEXP, 'g'));
  for (const match of matches) {
    result.push(parseOutputPath(match[1]));
  }
  return result;
}

export function parseOutputPath(outputPathWithObjectName: string): BuildOutputPath {
  const splits = outputPathWithObjectName.split('.').slice(1);
  if (splits.length !== 2) {
    throw new BuildConfigError(
      `Step output path must consist of two components joined with a dot, where first is the step ID, and second is the output name, e.g. "step3.output1". Passed: "${outputPathWithObjectName}"`
    );
  }
  const [stepId, outputId] = splits;
  return { stepId, outputId };
}
