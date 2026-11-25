import { describe, expect, it, vi } from "vitest";
import {
  FACILITATOR_MAX_RESPONSE_BYTES,
  FacilitatorResponseTooLargeError,
  createBoundedFacilitatorFetch,
  registerFacilitatorResponseLimit
} from "./bounded-facilitator-client.js";

describe("bounded facilitator responses", () => {
  it("accepts a response exactly at the byte limit", async () => {
    const body = "x".repeat(FACILITATOR_MAX_RESPONSE_BYTES);
    const fetch = createBoundedFacilitatorFetch(
      vi.fn<typeof globalThis.fetch>().mockResolvedValue(new Response(body)),
      () => true
    );

    const response = await fetch("https://facilitator.example/verify");

    await expect(response.text()).resolves.toBe(body);
  });

  it("rejects over-limit responses with a redacted typed error", async () => {
    const secret = "facilitator-secret";
    let cancelled = false;
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(
          new TextEncoder().encode(`${"x".repeat(FACILITATOR_MAX_RESPONSE_BYTES)}${secret}`)
        );
      },
      cancel() {
        cancelled = true;
      }
    });
    const fetch = createBoundedFacilitatorFetch(
      vi.fn<typeof globalThis.fetch>().mockResolvedValue(new Response(body)),
      () => true
    );
    const error = await fetch("https://facilitator.example/verify").catch(
      (caught: unknown) => caught
    );

    expect(error).toBeInstanceOf(Error);
    expect(error).toBeInstanceOf(FacilitatorResponseTooLargeError);
    expect(error).toMatchObject({
      message: `Facilitator response exceeded ${FACILITATOR_MAX_RESPONSE_BYTES}-byte limit`
    });
    if (error instanceof Error) {
      expect(error.message).not.toContain(secret);
    }
    expect(cancelled).toBe(true);
  });

  it("rejects from content length without reading the response body", async () => {
    const cancel = vi.fn().mockResolvedValue(undefined);
    const fetch = createBoundedFacilitatorFetch(
      vi
        .fn<typeof globalThis.fetch>()
        .mockResolvedValue(
          new Response(new ReadableStream({ cancel }), { headers: { "content-length": "2" } })
        ),
      () => true,
      1
    );

    await expect(fetch("https://facilitator.example/verify")).rejects.toBeInstanceOf(
      FacilitatorResponseTooLargeError
    );
    expect(cancel).toHaveBeenCalledOnce();
  });

  it("bounds registered facilitator endpoints without changing other fetches", async () => {
    const originalFetch = globalThis.fetch;
    const responseBody = "x".repeat(FACILITATOR_MAX_RESPONSE_BYTES + 1);
    const fetcher = vi
      .fn<typeof globalThis.fetch>()
      .mockResolvedValueOnce(new Response(responseBody))
      .mockResolvedValueOnce(new Response(responseBody));
    globalThis.fetch = fetcher;
    registerFacilitatorResponseLimit("https://facilitator.example");

    try {
      await expect(
        globalThis.fetch("https://facilitator.example/supported")
      ).rejects.toBeInstanceOf(FacilitatorResponseTooLargeError);
      await expect(
        globalThis.fetch("https://other.example/supported").then((response) => response.text())
      ).resolves.toBe(responseBody);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});
