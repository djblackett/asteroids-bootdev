import { ApiError } from './errors';

export interface BodyLimits {
  /** Maximum bytes accepted on the wire when Content-Encoding is gzip. */
  maxCompressedBytes: number;
  /** Maximum bytes of body after any decoding. Also the wire limit for an uncompressed body. */
  maxBodyBytes: number;
}

/**
 * Reads a request body with hard limits at every stage, so no input can make the Worker buffer or inflate an unbounded amount:
 *  1. only identity or gzip Content-Encoding is accepted;
 *  2. a declared Content-Length over the wire limit is refused before reading;
 *  3. the stream is counted as it arrives and cancelled the moment it exceeds the limit (Content-Length can lie or be absent);
 *  4. a gzip body is inflated through a stream that is again counted and cancelled at the decoded limit (a "zip bomb" stops at
 *     maxBodyBytes of output, however small its compressed form).
 */
export async function readBoundedBody(request: Request, limits: BodyLimits): Promise<Uint8Array> {
  const encoding = (request.headers.get('content-encoding') ?? 'identity').trim().toLowerCase();
  if (encoding !== 'identity' && encoding !== 'gzip') {
    throw new ApiError(415, 'unsupported_encoding', 'Content-Encoding must be identity or gzip');
  }
  const wireLimit = encoding === 'gzip' ? limits.maxCompressedBytes : limits.maxBodyBytes;

  const declared = request.headers.get('content-length');
  if (declared !== null) {
    const n = Number(declared);
    if (!Number.isFinite(n) || n < 0) throw new ApiError(400, 'bad_content_length', 'Invalid Content-Length');
    if (n > wireLimit) throw tooLarge(wireLimit);
  }
  if (!request.body) throw new ApiError(400, 'empty_body', 'Request body is required');

  const wire = await collect(request.body, wireLimit, 'request body');
  if (encoding === 'identity') return wire;

  let inflated: ReadableStream<Uint8Array>;
  try {
    inflated = new Response(wire as BodyInit).body!.pipeThrough(new DecompressionStream('gzip')) as ReadableStream<Uint8Array>;
  } catch {
    throw new ApiError(400, 'invalid_gzip', 'Body is not valid gzip data');
  }
  return collect(inflated, limits.maxBodyBytes, 'decompressed body');
}

function tooLarge(limit: number): ApiError {
  return new ApiError(413, 'payload_too_large', `Request body exceeds the ${limit} byte limit`);
}

async function collect(stream: ReadableStream<Uint8Array>, limit: number, what: string): Promise<Uint8Array> {
  const reader = stream.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > limit) {
        await reader.cancel().catch(() => undefined);
        throw tooLarge(limit);
      }
      chunks.push(value);
    }
  } catch (e) {
    if (e instanceof ApiError) throw e;
    // A stream that errors part-way is a truncated upload or corrupt gzip: the client can simply retry.
    throw new ApiError(400, 'invalid_body', `Could not read ${what}: it was truncated or corrupt`);
  }
  const out = new Uint8Array(total);
  let offset = 0;
  for (const c of chunks) {
    out.set(c, offset);
    offset += c.byteLength;
  }
  return out;
}
