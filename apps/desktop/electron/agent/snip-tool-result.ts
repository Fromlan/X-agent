/**
 * Stale tool-result snip (in-place content trim).
 *
 * Insipred by `esengine/DeepSeek-Reasonix` SPEC section 3.6:
 *   "stale tool output is snipped/pruned before summary compaction"
 *
 * Goal: large tool results in the conversation history balloon the context
 * long before compaction becomes necessary. Trim each oversized result to
 * `headKeep` + marker + `tailKeep` characters in place so subsequent LLM
 * requests see a smaller context, and so the eventual compaction has less
 * work to do (often the snip alone clears pressure).
 *
 * Design rules:
 *   - Pure functions over a duck-typed toolResult message shape. We do NOT
 *     import Pi's message type to keep this module cheap to load and to avoid
 *     compile-time coupling to Pi's internal layout.
 *   - `snipToolResultsInPlace` mutates the input `messages` array (the same
 *     array Pi hands out from `session.messages`). The marker is set on each
 *     snipped message so we never re-snip the same one.
 *   - Original content is intentionally discarded. The marker tells the model
 *     how to recover via `read -o N -l M`. Reasonix uses the same convention.
 */

export type SnipMarker = {
  originalChars: number;
  headChars: number;
  tailChars: number;
  /** Epoch ms when the snip was applied. */
  at: number;
};

export type SnipOptions = {
  /** Char threshold; results whose `content` is `<=` this are skipped. */
  threshold: number;
  /** Chars to keep at the head of each oversized content block. */
  headKeep: number;
  /** Chars to keep at the tail of each oversized content block. */
  tailKeep: number;
  /** Marker template; receive `{original}` and `{now}` placeholders. */
  marker?: string;
};

export type SnipReport = {
  /** Number of toolResult messages that were snipped. */
  snippedCount: number;
  /** Sum of `originalChars - (headKeep + tailKeep + marker.length)` across all snipped messages. */
  charsPruned: number;
};

const DEFAULT_MARKER =
  "\n\n[… tool result middle pruned (original {original} chars; re-read with `read -o <offset> -l <limit>` to recover) …]\n\n";

// --- duck-typed content / message shapes ---------------------------------

type ContentBlock = { type?: string; text?: string; [k: string]: unknown };

type MaybeToolResult = {
  role?: string;
  content?: ContentBlock[] | string | null;
  /** Existing marker; set after a prior snip. */
  snipped?: SnipMarker;
  [k: string]: unknown;
};

/**
 * True iff the message looks like a toolResult in the shape Pi emits.
 * We intentionally do not check the role string against an exact union:
 * the local role strings from Pi are stable, but a defensive check on
 * `content` array shape (the common case) is what actually filters here.
 */
export function isToolResultMessage(msg: unknown): msg is MaybeToolResult {
  if (!msg || typeof msg !== "object") return false;
  const m = msg as MaybeToolResult;
  if (m.role !== "toolResult") return false;
  // Either string content or [{type, text}, ...] array — Pi uses the array
  // shape; older sessions may still have plain strings.
  if (typeof m.content === "string") return true;
  if (Array.isArray(m.content)) return true;
  return false;
}

/** Total character count of a toolResult message's text content. */
export function measureToolResultChars(msg: MaybeToolResult): number {
  if (typeof msg.content === "string") return msg.content.length;
  if (Array.isArray(msg.content)) {
    let total = 0;
    for (const block of msg.content) {
      if (block && typeof block === "object" && typeof block.text === "string") {
        total += block.text.length;
      }
    }
    return total;
  }
  return 0;
}

// --- single-message snip -------------------------------------------------

function snipText(
  text: string,
  headKeep: number,
  tailKeep: number,
  marker: string,
  originalTotal: number,
): { text: string; originalChars: number } {
  // Defensive: if head + tail cover the whole text, no snip is needed.
  if (headKeep + tailKeep >= text.length) {
    return { text, originalChars: text.length };
  }
  const head = text.slice(0, headKeep);
  const tail = text.slice(text.length - tailKeep);
  const composed = head + marker + tail;
  return { text: composed, originalChars: text.length };
}

/**
 * Snip a single toolResult message in place. Returns the marker written onto
 * `msg.snipped`, or `null` if the message did not need snipping.
 */
export function snipOne(
  msg: MaybeToolResult,
  opts: SnipOptions,
  now: number = Date.now(),
): SnipMarker | null {
  if (opts.threshold <= 0) return null;
  if (msg.snipped) return null;
  const originalTotal = measureToolResultChars(msg);
  if (originalTotal <= opts.threshold) return null;

  const markerTemplate = opts.marker ?? DEFAULT_MARKER;
  const renderedMarker = markerTemplate
    .replace("{original}", String(originalTotal))
    .replace("{now}", String(now));

  if (typeof msg.content === "string") {
    const { text, originalChars } = snipText(
      msg.content,
      opts.headKeep,
      opts.tailKeep,
      renderedMarker,
      originalTotal,
    );
    msg.content = text;
    const marker: SnipMarker = {
      originalChars,
      headChars: opts.headKeep,
      tailChars: opts.tailKeep,
      at: now,
    };
    msg.snipped = marker;
    return marker;
  }

  if (Array.isArray(msg.content)) {
    let originalSum = 0;
    let touched = false;
    for (const block of msg.content) {
      if (
        block &&
        typeof block === "object" &&
        block.type === "text" &&
        typeof block.text === "string"
      ) {
        originalSum += block.text.length;
        if (block.text.length > opts.threshold) {
          const { text } = snipText(
            block.text,
            opts.headKeep,
            opts.tailKeep,
            renderedMarker,
            block.text.length,
          );
          block.text = text;
          touched = true;
        }
      }
    }
    if (!touched) return null;
    const marker: SnipMarker = {
      originalChars: originalSum,
      headChars: opts.headKeep,
      tailChars: opts.tailKeep,
      at: now,
    };
    msg.snipped = marker;
    return marker;
  }

  return null;
}

// --- batch snip ----------------------------------------------------------

/**
 * Walk `messages` in place; snip every toolResult whose content exceeds
 * `opts.threshold`. Returns aggregate stats.
 *
 * The function is non-atomic: if it throws mid-way, the messages already
 * touched keep their `snipped` marker and won't be re-snipped on the next
 * pass. Callers should treat partial completion as success and let the
 * next auto-maintain tick finish the rest.
 */
export function snipToolResultsInPlace(
  messages: unknown[],
  opts: SnipOptions,
  now: number = Date.now(),
): SnipReport {
  let snippedCount = 0;
  let charsPruned = 0;
  if (!Array.isArray(messages) || opts.threshold <= 0) {
    return { snippedCount: 0, charsPruned: 0 };
  }
  for (const msg of messages) {
    if (!isToolResultMessage(msg)) continue;
    const before = measureToolResultChars(msg);
    const marker = snipOne(msg, opts, now);
    if (marker) {
      snippedCount += 1;
      // after-snip char count = headKeep + markerLen + tailKeep (single text case)
      // or sum of per-block after-snip lengths. We compute from the original
      // minus the chars that were actually cut, measured as the diff in the
      // message's measured length.
      const after = measureToolResultChars(msg);
      charsPruned += Math.max(0, before - after);
    }
  }
  return { snippedCount, charsPruned };
}
