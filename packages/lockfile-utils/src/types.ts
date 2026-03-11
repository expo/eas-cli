export interface PackageInfo {
  version: string;
  peerDependencies?: Record<string, string>;
  optionalPeers?: Set<string>;
}

export interface LockfileData {
  packages: Map<string, PackageInfo>;
}

export interface DependencyMismatch {
  name: string;
  specifier: string;
  lockedVersion: string;
}

export interface PeerDependencyConflict {
  /** Package that declares the peer dependency */
  source: string;
  sourceVersion: string;
  /** The peer dependency that is not satisfied */
  peer: string;
  peerRange: string;
  /** The actual version of the peer in the lockfile */
  installedVersion: string;
}
