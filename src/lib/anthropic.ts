/**
 * The one Anthropic client, and the numbers that say what a call cost.
 *
 * Shared by every route that talks to the model. One client for the lifetime of the server
 * process rather than one per request, and one usage log so a design, a repair and a review
 * are all reported the same way and can be read against each other.
 */
import Anthropic from "@anthropic-ai/sdk";

export const client = new Anthropic();

/**
 * What each kind of token costs, relative to one uncached input token.
 *
 * Prices move and differ per model; these ratios have held. Keeping the log in
 * input-token-equivalents rather than dollars means it stays true when the price list
 * changes, and it still answers the only question that matters — which part of a turn the
 * money went to. Output is the number to watch: it is worth five of anything on the input
 * side, and the thinking budget is billed inside it.
 */
const BILLED_AS = { cacheRead: 0.1, cacheWrite5m: 1.25, cacheWrite1h: 2.0, output: 5 };

/** Prints per-request token usage so spend (and whether caching is hitting) is observable. */
export function logUsage(label: string, usage: Anthropic.Usage | undefined) {
  if (!usage) return;
  const cacheRead = usage.cache_read_input_tokens ?? 0;
  const cacheWrite = usage.cache_creation_input_tokens ?? 0;
  const write1h = usage.cache_creation?.ephemeral_1h_input_tokens ?? 0;
  const write5m = usage.cache_creation?.ephemeral_5m_input_tokens ?? cacheWrite - write1h;
  // Thinking is billed inside output_tokens and happens before a single character of the
  // answer, so it's the number that explains a long wait. Without it a slow request and a
  // stuck one look identical in the log.
  const thinking = usage.output_tokens_details?.thinking_tokens ?? 0;

  // One number for the turn, in input-token-equivalents, and the share of it that went on
  // output. Without this the log says how many tokens moved and nothing about where the
  // money went — and on a warm cache the answer is "almost all of it, into output".
  const billed =
    usage.input_tokens +
    cacheRead * BILLED_AS.cacheRead +
    write5m * BILLED_AS.cacheWrite5m +
    write1h * BILLED_AS.cacheWrite1h +
    usage.output_tokens * BILLED_AS.output;
  const outputShare = Math.round(((usage.output_tokens * BILLED_AS.output) / billed) * 100);

  console.log(
    `[${label}] in=${usage.input_tokens} out=${usage.output_tokens} ` +
      `(thinking=${thinking}) cache_read=${cacheRead} cache_write=${cacheWrite} ` +
      `(${cacheRead > 0 ? "cache HIT" : cacheWrite > 0 ? "cache written" : "no cache"}) ` +
      `billed=${Math.round(billed)}ite (${outputShare}% output)`,
  );
}

export function friendlyApiError(error: unknown): string {
  if (error instanceof Anthropic.RateLimitError) {
    return "Lots of people are making things right now. Wait a few seconds and try again!";
  }
  if (error instanceof Anthropic.AuthenticationError) {
    return "The ANTHROPIC_API_KEY isn't being accepted. Check it and restart.";
  }
  if (error instanceof Anthropic.APIError) {
    return "I couldn't reach my thinking brain just now. Please try again in a moment.";
  }
  // The answer arrived but didn't fit the shape it was asked for. Worth saying plainly:
  // asking again usually works, where "something went wrong" suggests nothing at all.
  if (error instanceof Error && /parse structured output/i.test(error.message)) {
    return "My answer came back in a shape I couldn't read. Please ask me again!";
  }
  return "Something went wrong while I was building that. Please try again.";
}
