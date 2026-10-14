/**
 * Line-based three-way merge (diff3) for canvas conflict recovery.
 *
 * `base` is the revision the editor loaded, `ours` the unsaved draft and
 * `theirs` the newer head. Lines changed on only one side merge cleanly; a
 * region both sides changed differently becomes a marked conflict block that
 * keeps both versions, so nothing is silently dropped.
 */

export type CanvasMergeLabels = { ours: string; theirs: string };

export type CanvasMergeResult = { text: string; conflicts: number };

/**
 * Above this many LCS cells the middle region is not aligned line-by-line; it
 * becomes one conflict block (still lossless, just coarser) so a pathological
 * document cannot allocate unbounded memory in the browser.
 */
const MAX_LCS_CELLS = 4_000_000;

/** For each `base` index, the matched index in `other`, or -1. */
function matchLines(base: readonly string[], other: readonly string[]): Int32Array {
  const matches = new Int32Array(base.length).fill(-1);
  let start = 0;
  while (start < base.length && start < other.length && base[start] === other[start]) {
    matches[start] = start;
    start += 1;
  }
  let baseEnd = base.length;
  let otherEnd = other.length;
  while (baseEnd > start && otherEnd > start && base[baseEnd - 1] === other[otherEnd - 1]) {
    baseEnd -= 1;
    otherEnd -= 1;
    matches[baseEnd] = otherEnd;
  }
  const rows = baseEnd - start;
  const columns = otherEnd - start;
  if (rows === 0 || columns === 0 || (rows + 1) * (columns + 1) > MAX_LCS_CELLS) return matches;

  // lengths[i][j] = LCS length of base[start+i..baseEnd) and other[start+j..otherEnd).
  const width = columns + 1;
  const lengths = new Uint32Array((rows + 1) * width);
  for (let i = rows - 1; i >= 0; i -= 1) {
    for (let j = columns - 1; j >= 0; j -= 1) {
      lengths[i * width + j] =
        base[start + i] === other[start + j]
          ? lengths[(i + 1) * width + j + 1] + 1
          : Math.max(lengths[(i + 1) * width + j], lengths[i * width + j + 1]);
    }
  }
  let i = 0;
  let j = 0;
  while (i < rows && j < columns) {
    if (base[start + i] === other[start + j]) {
      matches[start + i] = start + j;
      i += 1;
      j += 1;
    } else if (lengths[(i + 1) * width + j] >= lengths[i * width + j + 1]) {
      i += 1;
    } else {
      j += 1;
    }
  }
  return matches;
}

function sameLines(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && left.every((line, index) => line === right[index]);
}

export function mergeCanvasText(
  base: string,
  ours: string,
  theirs: string,
  labels: CanvasMergeLabels,
): CanvasMergeResult {
  if (ours === theirs || theirs === base) return { text: ours, conflicts: 0 };
  if (ours === base) return { text: theirs, conflicts: 0 };

  const baseLines = base.split("\n");
  const ourLines = ours.split("\n");
  const theirLines = theirs.split("\n");
  const toOurs = matchLines(baseLines, ourLines);
  const toTheirs = matchLines(baseLines, theirLines);
  const output: string[] = [];
  let conflicts = 0;
  let b = 0;
  let o = 0;
  let t = 0;

  while (b < baseLines.length || o < ourLines.length || t < theirLines.length) {
    if (b < baseLines.length && toOurs[b] === o && toTheirs[b] === t) {
      output.push(baseLines[b] ?? "");
      b += 1;
      o += 1;
      t += 1;
      continue;
    }
    // Next base line both sides kept: the end of this unstable region.
    let sync = b;
    while (sync < baseLines.length && (toOurs[sync] < 0 || toTheirs[sync] < 0)) sync += 1;
    const ourEnd = sync < baseLines.length ? toOurs[sync] : ourLines.length;
    const theirEnd = sync < baseLines.length ? toTheirs[sync] : theirLines.length;
    const baseChunk = baseLines.slice(b, sync);
    const ourChunk = ourLines.slice(o, ourEnd);
    const theirChunk = theirLines.slice(t, theirEnd);

    if (sameLines(ourChunk, baseChunk) || sameLines(ourChunk, theirChunk)) {
      output.push(...theirChunk);
    } else if (sameLines(theirChunk, baseChunk)) {
      output.push(...ourChunk);
    } else {
      conflicts += 1;
      output.push(
        `<<<<<<< ${labels.ours}`,
        ...ourChunk,
        "=======",
        ...theirChunk,
        `>>>>>>> ${labels.theirs}`,
      );
    }
    b = sync;
    o = ourEnd;
    t = theirEnd;
  }
  return { text: output.join("\n"), conflicts };
}

export type CanvasDiffLine = { kind: "same" | "added" | "removed"; text: string };

/** Line diff from `from` to `to` (history: current canvas → selected revision). */
export function diffCanvasLines(from: string, to: string): CanvasDiffLine[] {
  const fromLines = from.split("\n");
  const toLines = to.split("\n");
  const matches = matchLines(fromLines, toLines);
  const output: CanvasDiffLine[] = [];
  let next = 0;
  for (const [index, text] of fromLines.entries()) {
    const target = matches[index] ?? -1;
    if (target < 0) {
      output.push({ kind: "removed", text });
      continue;
    }
    for (; next < target; next += 1) output.push({ kind: "added", text: toLines[next] ?? "" });
    output.push({ kind: "same", text });
    next = target + 1;
  }
  for (; next < toLines.length; next += 1)
    output.push({ kind: "added", text: toLines[next] ?? "" });
  return output;
}
