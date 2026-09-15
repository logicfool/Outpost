import { AppError } from './validation';

export async function readBoundedText(response: Response, maxBytes: number): Promise<string> {
  const size = Number(response.headers.get('content-length'));
  if (Number.isFinite(size) && size > maxBytes)
    throw new AppError('RESPONSE_SIZE', 'The response was unexpectedly large.');
  if (!response.body?.getReader) {
    const value = await response.text();
    if (new TextEncoder().encode(value).byteLength > maxBytes)
      throw new AppError('RESPONSE_SIZE', 'The response was unexpectedly large.');
    return value;
  }
  const reader = response.body.getReader(),
    decoder = new TextDecoder();
  const chunks: string[] = [];
  let total = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > maxBytes) {
        await reader.cancel();
        throw new AppError('RESPONSE_SIZE', 'The response was unexpectedly large.');
      }
      chunks.push(decoder.decode(value, { stream: true }));
    }
    chunks.push(decoder.decode());
    return chunks.join('');
  } finally {
    reader.releaseLock();
  }
}

export function parseJsonBody(body: string, contentType: string): unknown {
  const value = body.replace(/^\uFEFF/, '').trim();
  if (
    /text\/html|application\/xhtml\+xml/i.test(contentType) ||
    !(value.startsWith('{') || value.startsWith('['))
  ) {
    throw new AppError(
      'SCHEMA',
      'The service returned a non-JSON response. Refresh or check connection diagnostics.',
    );
  }
  try {
    return JSON.parse(value);
  } catch {
    throw new AppError('SCHEMA', 'The service returned invalid JSON data.');
  }
}
