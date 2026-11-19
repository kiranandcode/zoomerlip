export const MAX_RESPONSE_BYTES = 16 * 1024 * 1024;
export class ResponseTooLarge extends Error {
  constructor() {
    super("This server response exceeds the 16 MiB limit.");
  }
}

/** Count decoded bytes, including chunked/compressed bodies with false headers. */
export async function boundedJSON(response: Response): Promise<unknown> {
  if (Number(response.headers.get("Content-Length")) > MAX_RESPONSE_BYTES) {
    void response.body?.cancel().catch(() => {});
    throw new ResponseTooLarge();
  }
  if (!response.body) throw new SyntaxError("Empty JSON response");
  const reader = response.body.getReader();
  let bytes = new Uint8Array(64 * 1024);
  let size = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > MAX_RESPONSE_BYTES) {
        void reader.cancel().catch(() => {});
        throw new ResponseTooLarge();
      }
      if (size > bytes.length) {
        const grown = new Uint8Array(
          Math.min(MAX_RESPONSE_BYTES, Math.max(size, bytes.length * 2)),
        );
        grown.set(bytes);
        bytes = grown;
      }
      bytes.set(value, size - value.byteLength);
    }
  } finally {
    reader.releaseLock();
  }
  return JSON.parse(new TextDecoder().decode(bytes.subarray(0, size)));
}
