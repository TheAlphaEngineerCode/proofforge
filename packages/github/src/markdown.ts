/**
 * Neutralising repository-derived text before it becomes a comment.
 *
 * Package names, benchmark names and policy rule names all originate in the
 * repository under review, which on a public project means an anonymous author.
 * They are then written into a Markdown comment that a reviewer reads as our
 * output.
 *
 * The risk is not script execution — GitHub strips that — it is forgery. A line
 * break lets a dependency name add its own bullet, so a package called
 * "left-pad\n(check) No secrets detected" prints a reassurance we never made.
 * The comment marker is worse: reproduce it and you decide which comment a later
 * run updates.
 *
 * So text from the repository is collapsed to a single line and its markup
 * defused, before it can be mistaken for something we said.
 */

/**
 * Line breaks, the C0/C1 controls, DEL, and the Unicode line separators.
 *
 * `no-control-regex` exists because a control character in a pattern is usually
 * a typo. Here they are the whole point - this is the set being removed.
 */
// eslint-disable-next-line no-control-regex
const CONTROL_AND_BREAKS = /[\u0000-\u001f\u007f-\u009f\u2028\u2029]+/gu;
const MAX_LENGTH = 200;

/**
 * Make untrusted text safe to place inside a Markdown line.
 *
 * Backticks are removed rather than escaped: these values are rendered inside
 * code spans, and a stray backtick would close the span and let the rest of the
 * value render as markup.
 */
export function inlineText(value: string): string {
  const flattened = value
    .replace(CONTROL_AND_BREAKS, " ")
    .replace(/`/g, "")
    // An HTML comment needs neither a control character nor a backtick, so the
    // rules above let it straight through. That matters more than it looks: the
    // comment marker is how a later run finds the comment to update, and a value
    // that reproduces it decides which comment we overwrite.
    .replace(/<!--/g, "&lt;!--")
    .replace(/-->/g, "--&gt;");
  const collapsed = flattened.replace(/\s{2,}/g, " ").trim();

  if (collapsed === "") return "(empty)";
  return collapsed.length > MAX_LENGTH ? `${collapsed.slice(0, MAX_LENGTH)}…` : collapsed;
}
