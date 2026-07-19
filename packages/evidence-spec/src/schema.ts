/**
 * Canonical Zod schema for the ProofForge proof-manifest.
 *
 * This is the single source of truth: the JSON Schema artifact and all runtime
 * validation are derived from it. Fields mirror the specification in
 * docs/evidence-spec.md.
 */
import { z } from "zod";

const sha256Hash = z
  .string()
  .regex(/^sha256:[a-f0-9]{64}$/, 'must be a "sha256:<64 hex chars>" digest');

const isoDateTime = z.string().datetime({ offset: true });

const percentage = z.number().min(0).max(100);

export const RiskLevel = z.enum(["low", "moderate", "elevated", "high", "critical"]);
export type RiskLevel = z.infer<typeof RiskLevel>;

export const ChangeType = z.enum(["validation", "agent"]);
export type ChangeType = z.infer<typeof ChangeType>;

const RepositorySchema = z
  .object({
    provider: z.enum(["github", "gitlab", "bitbucket", "local"]),
    owner: z.string().min(1),
    name: z.string().min(1),
    url: z.string().url(),
  })
  .strict();

const ChangeSchema = z
  .object({
    commit: z.string().min(7),
    baseCommit: z.string().min(7),
    branch: z.string().min(1),
    pullRequest: z.number().int().positive().nullable().optional(),
    title: z.string().min(1),
    request: z.string(),
    type: ChangeType.default("validation"),
  })
  .strict();

const EnvironmentSchema = z
  .object({
    runnerVersion: z.string().min(1),
    operatingSystem: z.string().min(1),
    containerImage: z.string(),
    runtimeVersions: z.record(z.string()),
    dependencyLockHashes: z.record(z.string()),
  })
  .strict();

const CoverageSchema = z
  .object({
    total: percentage,
    changedLines: percentage,
    before: percentage.optional(),
    after: percentage.optional(),
  })
  .strict();

const ArtifactRefSchema = z
  .object({
    name: z.string().min(1),
    type: z.string().min(1),
    url: z.string(),
    hash: sha256Hash.optional(),
  })
  .strict();

const TestsSchema = z
  .object({
    passed: z.number().int().nonnegative(),
    failed: z.number().int().nonnegative(),
    skipped: z.number().int().nonnegative(),
    durationMs: z.number().nonnegative(),
    coverage: CoverageSchema,
    reports: z.array(ArtifactRefSchema).default([]),
  })
  .strict();

const SecuritySchema = z
  .object({
    criticalVulnerabilities: z.number().int().nonnegative(),
    highVulnerabilities: z.number().int().nonnegative(),
    mediumVulnerabilities: z.number().int().nonnegative(),
    lowVulnerabilities: z.number().int().nonnegative(),
    secretsDetected: z.number().int().nonnegative(),
    sbomGenerated: z.boolean(),
    sbomUrl: z.string().default(""),
    reports: z.array(ArtifactRefSchema).default([]),
  })
  .strict();

const DependencyChangeSchema = z
  .object({
    name: z.string().min(1),
    version: z.string(),
    ecosystem: z.string(),
  })
  .strict();

const QualitySchema = z
  .object({
    complexityBefore: z.number().nonnegative(),
    complexityAfter: z.number().nonnegative(),
    duplicatedLinesPercentage: percentage,
    newDependencies: z.array(DependencyChangeSchema).default([]),
    removedDependencies: z.array(DependencyChangeSchema).default([]),
    architectureViolations: z.array(z.string()).default([]),
  })
  .strict();

const BenchmarkSchema = z
  .object({
    name: z.string().min(1),
    baselineMs: z.number().nonnegative(),
    candidateMs: z.number().nonnegative(),
    regressionPercentage: z.number(),
  })
  .strict();

const PerformanceSchema = z
  .object({
    benchmarks: z.array(BenchmarkSchema).default([]),
  })
  .strict();

const OperationsSchema = z
  .object({
    migrationsDetected: z.boolean(),
    migrationsReversible: z.boolean(),
    rollbackAvailable: z.boolean(),
    downtimeRequired: z.boolean(),
  })
  .strict();

const RiskCategoriesSchema = z.record(z.number().min(0).max(100));

const RiskSchema = z
  .object({
    score: z.number().int().min(0).max(100),
    level: RiskLevel,
    categories: RiskCategoriesSchema.default({}),
    reasons: z.array(z.string()).default([]),
  })
  .strict();

const PolicyOutcomeSchema = z
  .object({
    rule: z.string().min(1),
    message: z.string(),
    severity: z.enum(["info", "low", "medium", "high", "critical"]).optional(),
  })
  .strict();

const PoliciesSchema = z
  .object({
    passed: z.array(PolicyOutcomeSchema).default([]),
    failed: z.array(PolicyOutcomeSchema).default([]),
    warnings: z.array(PolicyOutcomeSchema).default([]),
  })
  .strict();

const AgentSummarySchema = z
  .object({
    agentType: z.string().min(1),
    provider: z.string(),
    model: z.string(),
    promptHash: z.string().optional(),
    inputTokens: z.number().int().nonnegative().optional(),
    outputTokens: z.number().int().nonnegative().optional(),
    cost: z.number().nonnegative().optional(),
  })
  .strict();

const SignatureSchema = z
  .object({
    algorithm: z.literal("ed25519"),
    publicKeyId: z.string(),
    value: z.string(),
  })
  .strict();

/**
 * The proof-manifest. `evidenceHash` and `signature.value` are excluded from the
 * hash computation (see src/hash.ts) so the document can carry its own digest.
 */
export const ManifestSchema = z
  .object({
    specVersion: z.string().regex(/^\d+\.\d+\.\d+$/),
    id: z.string().uuid(),
    repository: RepositorySchema,
    change: ChangeSchema,
    environment: EnvironmentSchema,
    tests: TestsSchema,
    security: SecuritySchema,
    quality: QualitySchema,
    performance: PerformanceSchema,
    operations: OperationsSchema,
    risk: RiskSchema,
    policies: PoliciesSchema,
    agents: z.array(AgentSummarySchema).default([]),
    artifacts: z.array(ArtifactRefSchema).default([]),
    evidenceHash: sha256Hash,
    signature: SignatureSchema,
    createdAt: isoDateTime,
  })
  .strict();

export type Manifest = z.infer<typeof ManifestSchema>;

/** Input shape before defaults are applied (useful for producers). */
export type ManifestInput = z.input<typeof ManifestSchema>;
