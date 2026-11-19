import { expect, it, vi } from "vitest";
import {
  boundedJSON,
  MAX_RESPONSE_BYTES,
  ResponseTooLarge,
} from "../src/responseBody";

it("rejects an oversized declared body without consuming it", async () => {
  const cancel = vi.fn();
  const response = new Response(new ReadableStream({ cancel }), {
    headers: { "Content-Length": String(MAX_RESPONSE_BYTES + 1) },
  });
  await expect(boundedJSON(response)).rejects.toBeInstanceOf(ResponseTooLarge);
  expect(cancel).toHaveBeenCalledOnce();
});
it.each([undefined, "2"])(
  "bounds actual streamed bytes regardless of Content-Length %s",
  async (length) => {
    let reads = 0;
    const cancel = vi.fn();
    const body = new ReadableStream({
      pull(controller) {
        reads++;
        controller.enqueue(new Uint8Array(1024 * 1024));
      },
      cancel,
    });
    const response = new Response(body, {
      headers: length ? { "Content-Length": length } : {},
    });
    await expect(boundedJSON(response)).rejects.toBeInstanceOf(
      ResponseTooLarge,
    );
    expect(reads).toBeLessThanOrEqual(18);
    expect(cancel).toHaveBeenCalledOnce();
  },
);
it("decodes JSON across split UTF-8 chunks", async () => {
  const bytes = new TextEncoder().encode('{"value":"λ🚀"}');
  const body = new ReadableStream({
    start(controller) {
      for (const byte of bytes) controller.enqueue(new Uint8Array([byte]));
      controller.close();
    },
  });
  await expect(boundedJSON(new Response(body))).resolves.toEqual({
    value: "λ🚀",
  });
});
