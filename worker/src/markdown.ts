/**
 * Parses the Markdown that Tana's read_node returns, e.g.
 *
 *   - [ ] Auto wassen #recurring_task <!-- node-id: EFloR4obMX -->
 *     - **Parent area or Project**: [Huis #area](tana:h0-6Ndbirv)
 *     - **Deadline Date**: Tomorrow <!-- node-id: hhVkV6rlfdZ3 -->
 *     - **Priority**: [P3 - Neutral](tana:TJCqLaS47z)
 */

export interface Ref {
  name: string;
  id: string;
}

export interface Field {
  text: string;
  refs: Ref[];
}

export interface ParsedNode {
  id: string | null;
  name: string;
  checked: boolean | null;
  tags: string[];
  fields: Record<string, Field>;
}

const NODE_ID = /<!--\s*node-id:\s*([^\s]+)\s*-->/;
const REF = /\[([^\]]*)\]\(tana:([^)]+)\)/g;
const FIELD_LINE = /^ {2}- \*\*(.+?)\*\*:\s?(.*)$/;

/** "Frank #person" → "Frank": a reference's label without its tag. */
const refName = (label: string) => label.replace(/\s+#\S+$/, '').trim();

/** Inline references in a node name ("[Frank](tana:abc) appen") become plain text. */
const plainText = (text: string) =>
  text.replace(REF, (_all, label: string) => refName(label)).replace(/\s+/g, ' ').trim();

export function parseNodeMarkdown(markdown: string): ParsedNode {
  const lines = markdown.split('\n');
  const first = lines[0] ?? '';
  const id = NODE_ID.exec(first)?.[1] ?? null;

  let head = first.replace(NODE_ID, '').replace(/^\s*-\s*/, '').trim();
  let checked: boolean | null = null;
  const box = /^\[( |x|X)\]\s*/.exec(head);
  if (box) {
    checked = box[1].toLowerCase() === 'x';
    head = head.slice(box[0].length);
  }

  // References first, so a reference's own "#tag" isn't read as the node's tag.
  head = plainText(head);
  const tags: string[] = [];
  let tagMatch: RegExpExecArray | null;
  const trailingTag = /\s+#([^\s#]+)$/;
  while ((tagMatch = trailingTag.exec(head))) {
    tags.unshift(tagMatch[1].replace(/_/g, ' '));
    head = head.slice(0, tagMatch.index);
  }

  const fields: Record<string, Field> = {};
  for (const line of lines.slice(1)) {
    const m = FIELD_LINE.exec(line);
    if (!m) {
      continue;
    }
    const raw = m[2].replace(NODE_ID, '').trim();
    const refs: Ref[] = [];
    const text = raw
      .replace(REF, (_all, name: string, refId: string) => {
        const clean = refName(name);
        refs.push({name: clean, id: refId});
        return clean;
      })
      .trim();
    fields[m[1]] = {text, refs};
  }

  return {id, name: head.trim(), checked, tags, fields};
}
