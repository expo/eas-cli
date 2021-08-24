declare module 'qrcode-terminal' {
  function generate(text: string, opts: { small: boolean }, cb: (code: string) => void): void;
}
