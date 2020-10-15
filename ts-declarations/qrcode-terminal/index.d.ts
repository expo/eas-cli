declare module 'qrcode-terminal' {
  function generate(text: string, cb: (code: string) => void): void;
}
