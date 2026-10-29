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
        const clean = name.replace(/\s+#\S+$/, '').trim();
        refs.push({name: clean, id: refId});
        return clean;
      })
      .trim();
    fields[m[1]] = {text, refs};
  }

  return {id, name: head.trim(), checked, tags, fields};
}
