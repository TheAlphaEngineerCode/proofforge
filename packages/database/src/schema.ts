/**
 * ProofForge metadata schema (Drizzle / PostgreSQL).
 *
 * This is the source of truth for migrations (`drizzle-kit generate`). The
 * production storage binds to these tables; local development and tests use the
 * in-memory storage, which implements the same {@link Storage} contract.
 */
import { relations } from "drizzle-orm";
import {
  boolean,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

export const users = pgTable("users", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull(),
  email: text("email").notNull().unique(),
  avatarUrl: text("avatar_url"),
  githubUserId: text("github_user_id").unique(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const sessions = pgTable(
  "sessions",
  {
    token: text("token").primaryKey(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  },
  (table) => [index("sessions_user_id_idx").on(table.userId)],
);

export const organizations = pgTable("organizations", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull(),
  slug: text("slug").notNull().unique(),
  ownerId: uuid("owner_id")
    .notNull()
    .references(() => users.id),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const repositories = pgTable(
  "repositories",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    owner: text("owner").notNull(),
    name: text("name").notNull(),
    defaultBranch: text("default_branch").notNull().default("main"),
    language: text("language"),
    private: boolean("private").notNull().default(false),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("repositories_org_idx").on(table.organizationId),
    // One record per repository per organization. Webhook deliveries are routed
    // to a repository row, so a duplicate would make the routing ambiguous —
    // and "whichever row the database returned first" is not an answer this
    // system can give about whose evidence a commit produced.
    uniqueIndex("repositories_full_name_idx").on(table.organizationId, table.owner, table.name),
  ],
);

export const installations = pgTable("installations", {
  id: uuid("id").primaryKey().defaultRandom(),
  githubInstallationId: integer("github_installation_id").notNull().unique(),
  accountLogin: text("account_login"),
  /**
   * The organization that claimed this installation, and therefore the tenant
   * its deliveries belong to. Null until someone claims it: an installation
   * announces itself by webhook, which says who owns it on GitHub but nothing
   * about who owns it here.
   */
  organizationId: uuid("organization_id").references(() => organizations.id, {
    onDelete: "set null",
  }),
  /** GitHub user id of whoever installed the App; the proof a claim is checked against. */
  installedBy: text("installed_by"),
  suspended: boolean("suspended").notNull().default(false),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const analyses = pgTable(
  "analyses",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    repositoryId: uuid("repository_id")
      .notNull()
      .references(() => repositories.id, { onDelete: "cascade" }),
    commitSha: text("commit_sha").notNull(),
    status: text("status").notNull(),
    riskScore: integer("risk_score"),
    riskLevel: text("risk_level"),
    evidenceBundleId: uuid("evidence_bundle_id"),
    error: text("error"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("analyses_repo_idx").on(table.repositoryId),
    // Evidence is bound to a commit, so a commit gets one analysis. GitHub sends
    // `push` and `pull_request` for the same head almost simultaneously and
    // redelivers on its own schedule; without this the check-then-create in the
    // webhook is a race that ends in two bundles describing one commit.
    uniqueIndex("analyses_commit_idx").on(table.repositoryId, table.commitSha),
  ],
);

export const evidenceBundles = pgTable("evidence_bundles", {
  id: uuid("id").primaryKey().defaultRandom(),
  analysisId: uuid("analysis_id")
    .notNull()
    .references(() => analyses.id, { onDelete: "cascade" }),
  commitSha: text("commit_sha").notNull(),
  manifestVersion: text("manifest_version").notNull(),
  riskScore: integer("risk_score").notNull(),
  evidenceHash: text("evidence_hash").notNull(),
  manifest: jsonb("manifest").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const policies = pgTable(
  "policies",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    version: text("version").notNull(),
    content: text("content").notNull(),
    active: boolean("active").notNull().default(true),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index("policies_org_idx").on(table.organizationId)],
);

export const auditLogs = pgTable(
  "audit_logs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: uuid("organization_id"),
    actorType: text("actor_type").notNull(),
    actorId: text("actor_id"),
    action: text("action").notNull(),
    targetType: text("target_type"),
    targetId: text("target_id"),
    metadata: jsonb("metadata"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index("audit_logs_org_idx").on(table.organizationId)],
);

export const organizationsRelations = relations(organizations, ({ many }) => ({
  repositories: many(repositories),
  policies: many(policies),
}));

export const repositoriesRelations = relations(repositories, ({ one, many }) => ({
  organization: one(organizations, {
    fields: [repositories.organizationId],
    references: [organizations.id],
  }),
  analyses: many(analyses),
}));

export const analysesRelations = relations(analyses, ({ one }) => ({
  repository: one(repositories, {
    fields: [analyses.repositoryId],
    references: [repositories.id],
  }),
}));
