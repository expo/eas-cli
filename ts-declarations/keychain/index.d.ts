declare module 'keychain' {
  interface Options {
    account: string;
    service: string;
    type: string;
  }

  interface OptionsWitPassword extends Options {
    password: string;
  }

  function getPassword(opts: Options, cb: (err: Error, password: string) => void): void;
  function setPassword(opts: OptionsWitPassword, cb: (err: Error) => void): void;
  function deletePassword(opts: Options, cb: (err: Error) => void): void;
}
