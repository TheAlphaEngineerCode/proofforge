/**
 * Versioning for the ProofForge proof-manifest specification.
 *
 * The manifest uses Semantic Versioning in its `specVersion` field. A validator
 * accepts any manifest whose MAJOR version is supported; MINOR/PATCH bumps are
 * backward compatible by contract (new optional fields only).
 */

/**
 * The specification version this library produces and fully understands.
 *
 * 1.1.0 adds `collectors`, recording which collectors ran and which did not, so
 * an unmeasured signal can be told apart from a clean one.
 */
export const SPEC_VERSION = "1.1.0" as const;

/** MAJOR versions this library can validate. */
export const SUPPORTED_MAJOR_VERSIONS: readonly number[] = [1];

export interface SemVer {
  major: number;
  minor: number;
  patch: number;
}

export function parseSemVer(value: string): SemVer | null {
  const match = /^(\d+)\.(\d+)\.(\d+)$/.exec(value.trim());
  if (!match) return null;
  return {
    major: Number(match[1]),
    minor: Number(match[2]),
    patch: Number(match[3]),
  };
}

/** Whether the library can validate a manifest declaring `specVersion`. */
export function isSupportedSpecVersion(specVersion: string): boolean {
  const parsed = parseSemVer(specVersion);
  if (!parsed) return false;
  return SUPPORTED_MAJOR_VERSIONS.includes(parsed.major);
}
