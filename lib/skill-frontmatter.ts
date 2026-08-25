import { parseFrontmatter } from "@earendil-works/pi-coding-agent";

const KEY = "disable-model-invocation";
const KEY_LINE = new RegExp(`^${KEY}\\s*:.*(?:\\r?\\n)?`, "m");

function isExplicitTrue(value: unknown): boolean {
  return value === true || value === "true";
}

function isExplicitFalse(value: unknown): boolean {
  return value === false || value === "false";
}

/**
 * Toggle `disable-model-invocation` with a surgical line edit so the rest of
 * the YAML keeps its original formatting.
 *
 * An explicit `false` must not be treated as "unset": adding a second
 * `disable-model-invocation: true` line leaves a duplicate key.
 */
export function setDisableModelInvocation(content: string, disable: boolean): string {
  const { frontmatter } = parseFrontmatter<Record<string, unknown>>(content);
  const current = frontmatter[KEY];

  if (disable) {
    if (isExplicitTrue(current)) return content;
    if (isExplicitFalse(current) || KEY_LINE.test(content)) {
      return content.replace(KEY_LINE, `${KEY}: true\n`);
    }
    const withFrontmatter = content.replace(/^---\r?\n/, `---\n${KEY}: true\n`);
    if (withFrontmatter !== content) return withFrontmatter;
    return `---\n${KEY}: true\n---\n${content}`;
  }

  if (isExplicitTrue(current) || isExplicitFalse(current) || KEY_LINE.test(content)) {
    return content.replace(KEY_LINE, "");
  }
  return content;
}
