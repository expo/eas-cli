# @expo/template-file

`@expo/template-file` provides file-level variable substitution (Mustache template style).

## API

```ts
templateFile(templateFilePath: string, outputFilePath: string, envs: Record<string, string | number>): Promise<void>
```

## Usage example

```ts
import templateFile from '@expo/template-file';

await templateFile('abc.json.template', 'abc.json', { ABC: 123, XYZ: 789 });
```

`abc.json.template` file contents:

```
{
  "someKey": {{ ABC }},
  "anotherKey": {{ XYZ }}
}
```

`abc.json` file should be created with the following contents:

```json
{
  "someKey": 123,
  "anotherKey": 789
}
```

## Repository

https://github.com/expo/eas-cli/tree/main/packages/template-file
