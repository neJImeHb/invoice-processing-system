const CHUNK_CHARS = 2000;
const OVERLAP_CHARS = 200;

export function chunkText(text: string): string[] {
  if (text.length === 0) {
    return [];
  }
  if (text.length <= CHUNK_CHARS) {
    return [text];
  }
  return splitText(text);
}

function splitText(text: string): string[] {
  const chunks: string[] = [];
  let start = 0;
  while (start < text.length) {
    const end = chooseEnd(text, start);
    const chunk = text.slice(start, end);
    if (chunk.length > 0) {
      chunks.push(chunk);
    }
    if (end >= text.length) {
      break;
    }
    const nextStart = end - OVERLAP_CHARS;
    start = nextStart > start ? nextStart : end;
  }
  return chunks;
}

function chooseEnd(text: string, start: number): number {
  const hardEnd = Math.min(start + CHUNK_CHARS, text.length);
  if (hardEnd >= text.length) {
    return text.length;
  }
  const newlineAt = lastNewline(text, start, hardEnd);
  if (newlineAt === undefined) {
    return hardEnd;
  }
  const snapped = newlineAt + 1;
  if (snapped - OVERLAP_CHARS <= start) {
    return hardEnd;
  }
  return snapped;
}

function lastNewline(text: string, start: number, hardEnd: number): number | undefined {
  const windowStart = Math.max(start + 1, hardEnd - OVERLAP_CHARS);
  const relative = text.slice(windowStart, hardEnd).lastIndexOf("\n");
  if (relative < 0) {
    return undefined;
  }
  return windowStart + relative;
}
