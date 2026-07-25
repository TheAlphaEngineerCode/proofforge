-- The two unique indexes below are new invariants, not new storage. On a
-- database that already holds duplicates this migration fails, loudly and
-- without changing anything — which is the intended outcome: de-duplicating
-- analyses means deleting evidence bundles along with them, and that is a
-- decision for an operator to make deliberately, not for a migration to make
-- on their behalf. To see what is in the way:
--
--   SELECT repository_id, commit_sha, count(*)
--     FROM analyses GROUP BY 1, 2 HAVING count(*) > 1;
--   SELECT organization_id, owner, name, count(*)
--     FROM repositories GROUP BY 1, 2, 3 HAVING count(*) > 1;
--
ALTER TABLE "installations" ADD COLUMN "organization_id" uuid;--> statement-breakpoint
ALTER TABLE "installations" ADD COLUMN "installed_by" text;--> statement-breakpoint
ALTER TABLE "installations" ADD CONSTRAINT "installations_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "analyses_commit_idx" ON "analyses" USING btree ("repository_id","commit_sha");--> statement-breakpoint
CREATE UNIQUE INDEX "repositories_full_name_idx" ON "repositories" USING btree ("organization_id","owner","name");