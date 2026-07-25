/**
 * Claiming a GitHub App installation for an organization.
 *
 * An installation arrives by webhook, which establishes who owns it on GitHub
 * and nothing at all about who owns it here. Until that gap is closed, a
 * delivery cannot be routed to a tenant — and routing it by repository name
 * instead means whoever registered `someone-else/repo` first receives their
 * analyses, and reads the evidence that comes with them.
 *
 * So a claim has to be proven, and the proof cannot be something the claimant
 * asserts. GitHub names the user who pressed Install in the installation event,
 * inside a body it signed; that identity is recorded then and compared now.
 * Installation ids are small consecutive integers, so first-come-claims-it would
 * be no protection at all.
 *
 * A person who signed in with dev-login has no GitHub identity and therefore
 * cannot claim anything, which is the correct answer rather than a limitation.
 *
 * One consequence is worth stating plainly: an installation that predates this
 * code has no recorded installer, because the event that carried it has already
 * been delivered and GitHub does not send it again. Such an installation cannot
 * be claimed and has to be reinstalled — a real cost, paid once, and preferable
 * to a weaker rule that would let anyone claim it instead.
 */
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type { AppDeps } from "../deps.js";
import { assertOwnedOrg } from "../access.js";
import { badRequest, conflict, forbidden, notFound, parse } from "../errors.js";
import { requireUser } from "../plugins/auth.js";

const ClaimInput = z.object({ organizationId: z.string().uuid() });

export function githubInstallationRoutes(app: FastifyInstance, deps: AppDeps): void {
  app.post("/api/v1/github/installations/:installationId/claim", async (request) => {
    const user = requireUser(request);
    const { organizationId } = parse(ClaimInput, request.body ?? {});

    const { installationId } = request.params as { installationId: string };
    const githubInstallationId = Number(installationId);
    if (!Number.isSafeInteger(githubInstallationId) || githubInstallationId <= 0) {
      throw badRequest("installationId must be a positive integer");
    }

    await assertOwnedOrg(deps, user.id, organizationId);

    const installation = await deps.storage.getInstallation(githubInstallationId);
    // Nothing here has heard of it — most likely the install happened and the
    // webhook has not arrived, or is not configured at all.
    if (!installation) throw notFound("installation not found");

    if (installation.organizationId === organizationId) return installation;
    if (installation.organizationId !== null) {
      throw conflict("installation is already connected to another organization");
    }

    // Two different failures, and telling them apart is the difference between
    // "you are not allowed" and "nobody is, until this is reinstalled".
    if (installation.installedBy === null) {
      throw forbidden(
        "this installation predates installer tracking; reinstall the app to connect it",
      );
    }
    if (installation.installedBy !== user.githubUserId) {
      request.log.warn(
        { githubInstallationId, userId: user.id },
        "[github] rejected a claim from someone who did not install the app",
      );
      throw forbidden("only the GitHub account that installed the app can connect it");
    }

    return deps.storage.claimInstallation(githubInstallationId, organizationId);
  });
}
