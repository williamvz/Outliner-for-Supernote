import type {LineMarker} from './lines';

export interface RecognizedLine {
  slot: number;
  level: number;
  marker: LineMarker;
  text: string;
}

export interface OutlineNode {
  /** Stable key: page key plus the first ruled-line slot of the node. */
  key: string;
  level: number;
  slots: number[];
  text: string;
  isTask: boolean;
  parentKey: string | null;
}

const TEXT_DASH = /^\s*[-–—•·]\s+/;
const TEXT_BOX = /^\s*(\[\s?\]|☐|□|▢)\s*/;

/**
 * Turns recognized lines into outline nodes:
 * - a dash or box starts a node at the line's level (box = task);
 * - a line without a marker right under a line at the same level continues
 *   that node (wrapped handwriting);
 * - any other unmarked line (first line, after a blank line, or at a new
 *   level) starts a node too.
 */
export function buildOutline(
  lines: RecognizedLine[],
  pageKey: string,
): OutlineNode[] {
  const nodes: OutlineNode[] = [];
  const openAtLevel: OutlineNode[] = [];
  let previous: {line: RecognizedLine; node: OutlineNode} | null = null;

  for (const raw of [...lines].sort((a, b) => a.slot - b.slot)) {
    const line = normaliseMarker(raw);
    if (!line.text) {
      continue;
    }
    const adjacent = previous !== null && line.slot === previous.line.slot + 1;
    if (
      previous &&
      adjacent &&
      line.marker === null &&
      line.level === previous.line.level
    ) {
      previous.node.text = `${previous.node.text} ${line.text}`;
      previous.node.slots.push(line.slot);
      previous = {line, node: previous.node};
      continue;
    }

    const level = Math.min(line.level, openAtLevel.length);
    const parent = level > 0 ? openAtLevel[level - 1] : undefined;
    const node: OutlineNode = {
      key: `${pageKey}:${line.slot}`,
      level,
      slots: [line.slot],
      text: line.text,
      isTask: line.marker === 'box',
      parentKey: parent ? parent.key : null,
    };
    nodes.push(node);
    openAtLevel.length = level;
    openAtLevel.push(node);
    previous = {line: {...line, level}, node};
  }
  return nodes;
}

/** The recognizer sometimes returns the marker as text; fold it back. */
function normaliseMarker(line: RecognizedLine): RecognizedLine {
  let {text, marker} = line;
  text = text.replace(/\s+/g, ' ').trim();
  if (TEXT_BOX.test(text)) {
    text = text.replace(TEXT_BOX, '');
    marker = marker ?? 'box';
  } else if (TEXT_DASH.test(text)) {
    text = text.replace(TEXT_DASH, '');
    marker = marker ?? 'dash';
  }
  return {...line, text: text.trim(), marker};
}
