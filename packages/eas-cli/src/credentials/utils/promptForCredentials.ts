import fs from 'fs-extra';
import path from 'path';
import untildify from 'untildify';

import Log from '../../log';
import { Question as PromptQuestion, confirmAsync, promptAsync } from '../../prompts';

export type Question = {
  field: string;
  question: string;
  type: 'file' | 'string' | 'password';
  base64Encode?: boolean;
};

export type CredentialSchema<T> = {
  name: string;
  questions: Question[];
  provideMethodQuestion?: {
    question?: string;
  };
  transformResultAsync?: (answers: Partial<T>) => Promise<T>;
};

let expertPromptLogged = false;
const EXPERT_PROMPT = (): void => {
  if (expertPromptLogged) {
    return;
  }
  Log.warn(`
In this mode, we won't be able to make sure that your credentials are valid.
Double check that you're uploading valid files for your app otherwise you may encounter strange errors!
When building for IOS make sure you've created your App ID on the Apple Developer Portal, that your App ID
is in app.json as \`bundleIdentifier\`, and that the provisioning profile you
upload matches that Team ID and App ID.
`);
  expertPromptLogged = true;
};

export async function askForUserProvidedAsync<T>(
  schema: CredentialSchema<T>,
  initialValues: Partial<T> = {}
): Promise<T | null> {
  if (await shouldAutoGenerateCredentialsAsync<T>(schema)) {
    return null;
  }
  EXPERT_PROMPT();
  return await getCredentialsFromUserAsync<T>(schema, initialValues);
}

export async function getCredentialsFromUserAsync<T>(
  credentialsSchema: CredentialSchema<T>,
  initialValues: Partial<T> = {}
): Promise<T> {
  const results: any = {};
  for (const question of credentialsSchema.questions) {
    results[question.field] = await askQuestionAndProcessAnswerAsync(
      question,
      (initialValues as any)?.[question.field]
    );
  }
  return credentialsSchema.transformResultAsync
    ? await credentialsSchema.transformResultAsync(results as Partial<T>)
    : (results as T);
}

export async function shouldAutoGenerateCredentialsAsync<T>(
  schema: CredentialSchema<T>
): Promise<boolean> {
  const answer = await confirmAsync({
    message: schema?.provideMethodQuestion?.question ?? `Generate a new ${schema.name}?`,
    initial: true,
  });
  return answer;
}

async function askQuestionAndProcessAnswerAsync(
  definition: Question,
  initialValue?: string
): Promise<string> {
  const questionObject = buildQuestionObject(definition, initialValue);
  const { input } = await promptAsync(questionObject);
  return await processAnswerAsync(definition, input);
}

function buildQuestionObject({ type, question }: Question, initialValue?: string): PromptQuestion {
  switch (type) {
    case 'string':
      return {
        type: 'text',
        name: 'input',
        initial: initialValue,
        message: question,
        validate: validateNonEmptyInput,
      };
    case 'file':
      return {
        type: 'text',
        name: 'input',
        message: question,
        format: produceAbsolutePath,
        validate: validateExistingFileAsync,
      };
    case 'password':
      return {
        type: 'password',
        name: 'input',
        message: question,
        validate: validateNonEmptyInput,
      };
  }
}

async function processAnswerAsync(
  { type, base64Encode }: Question,
  input: string
): Promise<string> {
  if (type === 'file') {
    return await fs.readFile(input, base64Encode ? 'base64' : 'utf8');
  } else {
    return input;
  }
}

function produceAbsolutePath(filePath: string): string {
  const untildified = untildify(filePath.trim());
  return !path.isAbsolute(untildified) ? path.resolve(untildified) : untildified;
}

function validateNonEmptyInput(val: string): boolean {
  return val !== '';
}

async function validateExistingFileAsync(filePath: string): Promise<boolean | string> {
  try {
    const stats = await fs.stat(filePath);
    if (stats.isFile()) {
      return true;
    }
    return 'Input is not a file.';
  } catch {
    return 'File does not exist.';
  }
}
