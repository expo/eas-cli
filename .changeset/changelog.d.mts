export declare function getAttributionAsync(changeset: {
  id: string;
  commit?: string;
}): Promise<string>;

declare const changelogFunctions: {
  getReleaseLine: (...args: never[]) => Promise<string>;
  getDependencyReleaseLine: (...args: never[]) => Promise<string>;
};

export default changelogFunctions;
