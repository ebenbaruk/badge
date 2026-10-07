/**
 * Token counting for the "context selected vs whole context" statistic shown with each brief. o200k_base is the
 * tokenizer of current OpenAI models; for other models it is a close, documented estimate. The ranks ship with
 * js-tiktoken, so counting never touches the network (the enclave has no egress besides the LLM gateway).
 */
import { Tiktoken } from "js-tiktoken/lite";
import o200kBase from "js-tiktoken/ranks/o200k_base";

/** Number of tokens of `text`. */
export type TokenCounter = (text: string) => number;

/** A counter backed by the o200k_base encoding (the encoder is built once: it takes ~100 ms). */
export function createO200kTokenCounter(): TokenCounter {
  const encoder = new Tiktoken(o200kBase);
  return (text) => encoder.encode(text).length;
}
