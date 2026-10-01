/** Recognize a real Markdown heading, including an optional explanation such as '(findings that block)'. */
const HEADING = /^(#{1,3})[ \t]+Acceptance criteria(?:[ \t]+\([^\r\n)]+\))?[ \t]*\r?$/im;

/** Mask comments and fenced examples while keeping offsets into the original Markdown. */
function headings(body: string): string {
  const mask = (text: string) => text.replace(/[^\r\n]/g, " ");
  let fence: string | undefined;
  return body.replace(/<!--[\s\S]*?-->/g, mask).split(/(?<=\n)/).map((line) => {
    const marker = /^[ ]{0,3}(`{3,}|~{3,})/.exec(line)?.[1];
    if (!fence && marker) { fence = marker; return mask(line); }
    if (fence) {
      if (marker && marker[0] === fence[0] && marker.length >= fence.length && /^[ ]{0,3}(?:`+|~+)[ \t]*\r?\n?$/.test(line)) fence = undefined;
      return mask(line);
    }
    return line;
  }).join("");
}

export function acceptanceCriteriaSection(body: string): string | null {
  const visible = headings(body);
  const heading = HEADING.exec(visible);
  if (!heading) return null;
  const start = heading.index + heading[0].length;
  const next = /^#{1,3}[ \t]+/m.exec(visible.slice(start));
  return body.slice(start, next ? start + next.index : undefined).replace(/^\r?\n/, "");
}

/** The model supplies data; Crewbie owns the Markdown required by the execution contract. */
export function taskBody(scope: string, criteria: string[]): string {
  return `${scope}\n\n## Acceptance criteria\n${criteria.map((item) => `- ${item.replace(/\r?\n/g, "\n  ")}`).join("\n")}`;
}
