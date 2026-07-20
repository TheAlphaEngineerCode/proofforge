/**
 * Removing credentials from anything on its way to a log.
 *
 * This lived inside the agents package, where it protected the one string that
 * reached a manifest. Logs travel further and more often — to a file, to a
 * shipper, to whoever is debugging — so the redaction belongs at the point
 * everything passes through rather than at each place someone remembered.
 *
 * It is a net, not a guarantee. A secret in an unrecognised format still gets
 * through, which is why nothing here is an excuse to log a credential on
 * purpose.
 */

/**
 * Order matters, and the URL pattern has to come first.
 *
 * The named-credential pattern below cannot know where a value ends, so it runs
 * to the next whitespace. On a git error — `https://x-access-token:ghs_…@github
 * .com/acme/api.git` — that swallows the host and the repository along with the
 * token, leaving a line that is safe and useless. Redacting the URL authority
 * first consumes the credential precisely and leaves the rest of the URL, which
 * is the part worth logging.
 */
const PATTERNS: readonly RegExp[] = [
  // A URL carrying credentials in its authority.
  /\b([a-z][a-z0-9+.-]*:\/\/)[^\s/@:]+:[^\s/@]+@/gi,
  // Token shapes with a recognisable prefix.
  /\b(sk|pk|ghp|gho|ghs|ghu|github_pat|glpat|xox[baprs])[-_][A-Za-z0-9_-]{8,}/gi,
  // Anything introduced as a credential, whatever the value looks like.
  /\b(bearer|authorization|x-api-key|api[_-]?key|password|passwd|secret|token)\b(\s*[:=]\s*|\s+)("?)[^\s",}]{6,}\3/gi,
];

const REPLACEMENTS: readonly string[] = ["$1[redacted]@", "$1-[redacted]", "$1$2[redacted]"];

export function redact(value: string): string {
  let out = value;
  PATTERNS.forEach((pattern, index) => {
    out = out.replace(pattern, REPLACEMENTS[index] ?? "[redacted]");
  });
  return out;
}

/**
 * Redact through a whole structure.
 *
 * Log fields are objects, and a token is as likely to arrive as a nested value
 * as it is inside a message. Keys named like secrets are dropped outright
 * rather than pattern-matched, since the name is better evidence than the shape.
 */
export function redactValue(value: unknown, depth = 0): unknown {
  if (depth > 8) return "[too deep]";
  if (typeof value === "string") return redact(value);
  if (Array.isArray(value)) return value.map((item) => redactValue(item, depth + 1));
  if (value !== null && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [key, entry] of Object.entries(value)) {
      out[key] = looksSecret(key) ? "[redacted]" : redactValue(entry, depth + 1);
    }
    return out;
  }
  return value;
}

/**
 * Word boundaries in a key name, including camelCase ones.
 *
 * Without the first step this only understood `access_token` and missed
 * `accessToken`, which is the spelling almost every object in this codebase
 * actually uses — the check read as thorough while covering the rarer half.
 */
function looksSecret(key: string): boolean {
  const separated = key.replace(/([a-z0-9])([A-Z])/g, "$1_$2");
  return /(^|[_-])(password|passwd|secret|token|apikey|api_key|authorization|credential)s?([_-]|$)/i.test(
    separated,
  );
}
