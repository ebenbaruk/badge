import { describe, expect, it } from "vitest";
import { z } from "zod";
import { chatResponse, fakeFetch, TEST_API_KEY, testProfile } from "../../test/fakes";
import { OpenAiCompatibleClient } from "./client";
import { LlmConfigError, LlmOutputError, LlmRequestError } from "./errors";

const Answer = z.object({ ok: z.boolean(), note: z.string().nullable() });
const USER = [{ role: "user" as const, content: "question" }];

describe("OpenAiCompatibleClient.structuredCompletion", () => {
  it("sends a strict json_schema with reasoning off and returns the validated object", async () => {
    const { impl, requests } = fakeFetch([{ body: chatResponse('{"ok":true,"note":null}') }]);
    const client = new OpenAiCompatibleClient(testProfile("build"), { fetch: impl });

    await expect(client.structuredCompletion(Answer, USER, { name: "answer" })).resolves.toEqual({
      ok: true,
      note: null,
    });

    const [request] = requests;
    expect(request?.url).toBe("https://api.example.test/v1/chat/completions");
    expect(request?.headers["authorization"]).toBe(`Bearer ${TEST_API_KEY}`);
    expect(request?.body).toMatchObject({
      model: "chat-model",
      reasoning_effort: "none",
      max_completion_tokens: expect.any(Number),
      response_format: {
        type: "json_schema",
        json_schema: {
          name: "answer",
          strict: true,
          schema: { type: "object", additionalProperties: false },
        },
      },
    });
    expect(request?.body).not.toHaveProperty("max_tokens");
  });

  it("uses max_tokens on the phala profile", async () => {
    const { impl, requests } = fakeFetch([{ body: chatResponse('{"ok":false,"note":"x"}') }]);
    await new OpenAiCompatibleClient(testProfile("phala"), { fetch: impl }).structuredCompletion(
      Answer,
      USER,
    );
    expect(requests[0]?.body).toHaveProperty("max_tokens");
    expect(requests[0]?.body).not.toHaveProperty("max_completion_tokens");
  });

  it.each([
    ["invalid JSON", chatResponse("not json")],
    ["a schema mismatch", chatResponse('{"ok":"yes","note":null}')],
    ["a truncated answer", chatResponse('{"ok":tr', "length")],
    ["empty content", chatResponse(null)],
  ])("rejects %s with LlmOutputError", async (_label, body) => {
    const { impl } = fakeFetch([{ body }]);
    const client = new OpenAiCompatibleClient(testProfile(), { fetch: impl });
    await expect(client.structuredCompletion(Answer, USER)).rejects.toBeInstanceOf(LlmOutputError);
  });

  it("refuses a schema with optional fields before calling the endpoint", async () => {
    const { impl, requests } = fakeFetch([]);
    const client = new OpenAiCompatibleClient(testProfile(), { fetch: impl });
    await expect(
      client.structuredCompletion(z.object({ a: z.string().optional() }), USER),
    ).rejects.toBeInstanceOf(LlmConfigError);
    expect(requests).toHaveLength(0);
  });
});

describe("OpenAiCompatibleClient errors", () => {
  it("reports HTTP errors with the status and never the key", async () => {
    const { impl } = fakeFetch([{ status: 401, body: { error: { message: `bad key ${TEST_API_KEY}` } } }]);
    const client = new OpenAiCompatibleClient(testProfile(), { fetch: impl });
    const error = await client.complete(USER).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(LlmRequestError);
    expect((error as LlmRequestError).status).toBe(401);
    expect((error as Error).message).not.toContain(TEST_API_KEY);
    expect((error as Error).message).toContain("[redacted]");
  });

  it("retries 5xx then succeeds", async () => {
    const { impl, requests } = fakeFetch([{ status: 503, body: "busy" }, { body: chatResponse("hello") }]);
    const client = new OpenAiCompatibleClient(testProfile(), { fetch: impl, maxRetries: 1 });
    await expect(client.complete(USER)).resolves.toBe("hello");
    expect(requests).toHaveLength(2);
  });

  it("does not retry 4xx", async () => {
    const { impl, requests } = fakeFetch([{ status: 400, body: "bad" }]);
    const client = new OpenAiCompatibleClient(testProfile(), { fetch: impl, maxRetries: 3 });
    await expect(client.complete(USER)).rejects.toBeInstanceOf(LlmRequestError);
    expect(requests).toHaveLength(1);
  });
});

describe("OpenAiCompatibleClient.embed", () => {
  const vector = (seed: number) => Array.from({ length: 384 }, (_, i) => seed + i);

  it("returns vectors in input order and asks OpenAI for 384 dimensions", async () => {
    const { impl, requests } = fakeFetch([
      {
        body: {
          data: [
            { index: 1, embedding: vector(2) },
            { index: 0, embedding: vector(1) },
          ],
        },
      },
    ]);
    const vectors = await new OpenAiCompatibleClient(testProfile("build"), { fetch: impl }).embed(["a", "b"]);
    expect(vectors.map((v) => v[0])).toEqual([1, 2]);
    expect(requests[0]?.body).toMatchObject({ model: "embed-model", input: ["a", "b"], dimensions: 384 });
  });

  it("omits dimensions on phala and rejects vectors of the wrong size", async () => {
    const { impl, requests } = fakeFetch([{ body: { data: [{ index: 0, embedding: [0.1, 0.2] }] } }]);
    const client = new OpenAiCompatibleClient(testProfile("phala"), { fetch: impl });
    await expect(client.embed(["a"])).rejects.toThrow(/2 dimensions, expected 384/);
    expect(requests[0]?.body).not.toHaveProperty("dimensions");
  });

  it("makes no call for an empty input", async () => {
    const { impl, requests } = fakeFetch([]);
    await expect(new OpenAiCompatibleClient(testProfile(), { fetch: impl }).embed([])).resolves.toEqual([]);
    expect(requests).toHaveLength(0);
  });
});
