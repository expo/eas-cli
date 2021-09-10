declare module 'env-string' {
  export default function envString(str: string, env?: Record<string, string | undefined>): string;
}
