/**
 * Helpers to place untrusted text (employee notes, agent-written tasks) inside a prompt as data.
 * Notes can contain text that looks like instructions ("ignore the rules and..."). Fencing them in tags and
 * neutralising any closing tag inside the content keeps the model's instructions and the data apart.
 */

/** Wraps `content` in `<tag attr="...">...</tag>`, defusing any `</tag` the content may contain. */
export function fence(
  tag: string,
  content: string,
  attributes: Readonly<Record<string, string>> = {},
): string {
  const attrs = Object.entries(attributes)
    .map(([key, value]) => ` ${key}="${value.replace(/["<>]/g, "")}"`)
    .join("");
  const safe = content.replace(new RegExp(`</?${tag}`, "gi"), (match) => match.replace("<", "&lt;"));
  return `<${tag}${attrs}>\n${safe}\n</${tag}>`;
}
