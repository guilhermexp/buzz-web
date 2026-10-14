/** Line-level Myers diff with unified hunks and split-view pairing. */

export type DiffLine =
  | { type: "context"; oldLine: number; newLine: number; text: string }
  | { type: "del"; oldLine: number; text: string }
  | { type: "add"; newLine: number; text: string };

export interface DiffHunk {
  oldStart: number;
  oldLines: number;
  newStart: number;
  newLines: number;
  lines: DiffLine[];
}

/** Stable per-hunk identity of a diff line (its side and line number). */
export function diffLineKey(line: DiffLine): string {
  return line.type === "add" ? `a${line.newLine}` : `${line.type}${line.oldLine}`;
}

export function splitLines(text: string): string[] {
  if (!text) return [];
  const lines = text.split("\n");
  if (lines[lines.length - 1] === "") lines.pop();
  return lines;
}

/** Edit script over full line arrays (Myers O((N+M)D), linear-space trace per step). */
export function diffLines(oldLines: readonly string[], newLines: readonly string[]): DiffLine[] {
  // Trim common prefix/suffix first; the typical PR edit is local.
  let prefix = 0;
  while (
    prefix < oldLines.length &&
    prefix < newLines.length &&
    oldLines[prefix] === newLines[prefix]
  ) {
    prefix += 1;
  }
  let suffix = 0;
  while (
    suffix < oldLines.length - prefix &&
    suffix < newLines.length - prefix &&
    oldLines[oldLines.length - 1 - suffix] === newLines[newLines.length - 1 - suffix]
  ) {
    suffix += 1;
  }
  const a = oldLines.slice(prefix, oldLines.length - suffix);
  const b = newLines.slice(prefix, newLines.length - suffix);
  const n = a.length;
  const m = b.length;
  const max = n + m;
  const offset = max + 1;
  const v = new Int32Array(2 * max + 3);
  const trace: Int32Array[] = [];
  let found = n === 0 && m === 0;
  for (let d = 0; d <= max && !found; d += 1) {
    trace.push(v.slice());
    for (let k = -d; k <= d; k += 2) {
      let x =
        k === -d || (k !== d && (v[offset + k - 1] as number) < (v[offset + k + 1] as number))
          ? (v[offset + k + 1] as number)
          : (v[offset + k - 1] as number) + 1;
      let y = x - k;
      while (x < n && y < m && a[x] === b[y]) {
        x += 1;
        y += 1;
      }
      v[offset + k] = x;
      if (x >= n && y >= m) {
        found = true;
        break;
      }
    }
  }
  if (n || m) trace.push(v.slice());

  const middle: DiffLine[] = [];
  let x = n;
  let y = m;
  for (let d = trace.length - 2; d >= 0 && (x > 0 || y > 0); d -= 1) {
    const prev = trace[d] as Int32Array;
    const k = x - y;
    const prevK =
      k === -d || (k !== d && (prev[offset + k - 1] as number) < (prev[offset + k + 1] as number))
        ? k + 1
        : k - 1;
    const prevX = prev[offset + prevK] as number;
    const prevY = prevX - prevK;
    while (x > prevX && y > prevY) {
      x -= 1;
      y -= 1;
      middle.push({ type: "context", oldLine: 0, newLine: 0, text: a[x] as string });
    }
    if (d === 0) break;
    if (x === prevX) {
      y -= 1;
      middle.push({ type: "add", newLine: 0, text: b[y] as string });
    } else {
      x -= 1;
      middle.push({ type: "del", oldLine: 0, text: a[x] as string });
    }
  }
  while (x > 0 && y > 0) {
    x -= 1;
    y -= 1;
    middle.push({ type: "context", oldLine: 0, newLine: 0, text: a[x] as string });
  }
  middle.reverse();

  const script: DiffLine[] = [];
  let oldNo = 1;
  let newNo = 1;
  const push = (line: DiffLine) => {
    if (line.type === "context") {
      script.push({ type: "context", oldLine: oldNo, newLine: newNo, text: line.text });
      oldNo += 1;
      newNo += 1;
    } else if (line.type === "del") {
      script.push({ type: "del", oldLine: oldNo, text: line.text });
      oldNo += 1;
    } else {
      script.push({ type: "add", newLine: newNo, text: line.text });
      newNo += 1;
    }
  };
  for (let index = 0; index < prefix; index += 1) {
    push({ type: "context", oldLine: 0, newLine: 0, text: oldLines[index] as string });
  }
  for (const line of middle) push(line);
  for (let index = oldLines.length - suffix; index < oldLines.length; index += 1) {
    push({ type: "context", oldLine: 0, newLine: 0, text: oldLines[index] as string });
  }
  return script;
}

/** Group an edit script into hunks with `context` unchanged lines around changes. */
export function toHunks(script: readonly DiffLine[], context = 3): DiffHunk[] {
  const changed = script.flatMap((line, index) => (line.type === "context" ? [] : [index]));
  if (!changed.length) return [];
  const ranges: [number, number][] = [];
  for (const index of changed) {
    const start = Math.max(0, index - context);
    const end = Math.min(script.length - 1, index + context);
    const last = ranges[ranges.length - 1];
    if (last && start <= last[1] + 1) last[1] = Math.max(last[1], end);
    else ranges.push([start, end]);
  }
  return ranges.map(([start, end]) => {
    const lines = script.slice(start, end + 1);
    const oldNumbers = lines.flatMap((line) => (line.type === "add" ? [] : [line.oldLine]));
    const newNumbers = lines.flatMap((line) => (line.type === "del" ? [] : [line.newLine]));
    const firstOld = script
      .slice(0, start)
      .reduce((count, line) => (line.type === "add" ? count : count + 1), 0);
    const firstNew = script
      .slice(0, start)
      .reduce((count, line) => (line.type === "del" ? count : count + 1), 0);
    return {
      oldStart: oldNumbers[0] ?? firstOld,
      oldLines: oldNumbers.length,
      newStart: newNumbers[0] ?? firstNew,
      newLines: newNumbers.length,
      lines,
    };
  });
}

export type SplitRow = { left: DiffLine | null; right: DiffLine | null };

/** Pair deletions with following additions for a side-by-side view. */
export function toSplitRows(lines: readonly DiffLine[]): SplitRow[] {
  const rows: SplitRow[] = [];
  let index = 0;
  while (index < lines.length) {
    const line = lines[index] as DiffLine;
    if (line.type === "context") {
      rows.push({ left: line, right: line });
      index += 1;
      continue;
    }
    const deletions: DiffLine[] = [];
    const additions: DiffLine[] = [];
    while (index < lines.length && (lines[index] as DiffLine).type === "del") {
      deletions.push(lines[index] as DiffLine);
      index += 1;
    }
    while (index < lines.length && (lines[index] as DiffLine).type === "add") {
      additions.push(lines[index] as DiffLine);
      index += 1;
    }
    for (let row = 0; row < Math.max(deletions.length, additions.length); row += 1) {
      rows.push({ left: deletions[row] ?? null, right: additions[row] ?? null });
    }
  }
  return rows;
}
