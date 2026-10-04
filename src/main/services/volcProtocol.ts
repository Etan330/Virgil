// Volcengine (Doubao) streaming ASR binary WebSocket framing.
// Protocol: https://www.volcengine.com/docs/6561/1354869
//
// Frame = Header(4B) | [Sequence(4B)] | Payload size(4B) | Payload
// Header byte0: protocol version(4b)=0b0001 | header size(4b)=0b0001 (value x 4 = bytes)
// Header byte1: message type(4b) | message type specific flags(4b)
// Header byte2: serialization(4b) | compression(4b)
// Header byte3: reserved = 0x00
// All integers are big-endian.

import { gzipSync, gunzipSync } from 'node:zlib';

export const PROTOCOL_VERSION = 0b0001;
export const HEADER_SIZE_WORDS = 0b0001; // 1 x 4 = 4 bytes

export const MSG_FULL_CLIENT_REQUEST = 0b0001;
export const MSG_AUDIO_ONLY_REQUEST = 0b0010;
export const MSG_FULL_SERVER_RESPONSE = 0b1001;
export const MSG_ERROR_RESPONSE = 0b1111;

export const FLAG_NO_SEQUENCE = 0b0000;
export const FLAG_POSITIVE_SEQUENCE = 0b0001;
export const FLAG_LAST_PACKET = 0b0010;
export const FLAG_NEGATIVE_SEQUENCE = 0b0011;

export const SERIALIZATION_NONE = 0b0000;
export const SERIALIZATION_JSON = 0b0001;
export const COMPRESSION_NONE = 0b0000;
export const COMPRESSION_GZIP = 0b0001;

export function buildHeader(
  messageType: number,
  flags: number,
  serialization: number,
  compression: number,
): Buffer {
  const header = Buffer.alloc(4);
  header[0] = (PROTOCOL_VERSION << 4) | HEADER_SIZE_WORDS;
  header[1] = (messageType << 4) | flags;
  header[2] = (serialization << 4) | compression;
  header[3] = 0x00;
  return header;
}

/** Handshake frame: header + payload size + gzip(JSON request params). */
export function buildFullClientRequest(params: unknown, compress = true): Buffer {
  const json = Buffer.from(JSON.stringify(params), 'utf8');
  const payload = compress ? gzipSync(json) : json;
  const size = Buffer.alloc(4);
  size.writeUInt32BE(payload.length, 0);
  return Buffer.concat([
    buildHeader(
      MSG_FULL_CLIENT_REQUEST,
      FLAG_NO_SEQUENCE,
      SERIALIZATION_JSON,
      compress ? COMPRESSION_GZIP : COMPRESSION_NONE,
    ),
    size,
    payload,
  ]);
}

/** Audio frame: header + payload size + gzip(raw pcm_s16le). */
export function buildAudioRequest(pcm: Buffer, isLast: boolean, compress = true): Buffer {
  const payload = compress ? gzipSync(pcm) : pcm;
  const size = Buffer.alloc(4);
  size.writeUInt32BE(payload.length, 0);
  return Buffer.concat([
    buildHeader(
      MSG_AUDIO_ONLY_REQUEST,
      isLast ? FLAG_LAST_PACKET : FLAG_NO_SEQUENCE,
      SERIALIZATION_NONE,
      compress ? COMPRESSION_GZIP : COMPRESSION_NONE,
    ),
    size,
    payload,
  ]);
}

export interface ParsedServerFrame {
  messageType: number;
  flags: number;
  sequence: number | null;
  payload: Buffer | null;
  errorCode: number | null;
  errorMessage: string | null;
}

/** Parse one complete WebSocket binary message from the server. */
export function parseServerFrame(raw: Buffer, compress = true): ParsedServerFrame {
  if (raw.length < 4) {
    return {
      messageType: -1,
      flags: 0,
      sequence: null,
      payload: null,
      errorCode: null,
      errorMessage: 'frame too short',
    };
  }
  const messageType = raw[1] >> 4;
  const flags = raw[1] & 0x0f;
  const compression = raw[2] & 0x0f;
  const headerSize = (raw[0] & 0x0f) * 4;
  const body = raw.subarray(headerSize);

  if (messageType === MSG_ERROR_RESPONSE) {
    const code = body.length >= 4 ? body.readUInt32BE(0) : 0;
    const msgSize = body.length >= 8 ? body.readUInt32BE(4) : 0;
    const message = body.subarray(8, 8 + msgSize).toString('utf8');
    return {
      messageType,
      flags,
      sequence: null,
      payload: null,
      errorCode: code,
      errorMessage: message,
    };
  }

  // full server response: Sequence(4B) | payload size(4B) | payload
  if (body.length < 8) {
    return {
      messageType,
      flags,
      sequence: null,
      payload: null,
      errorCode: null,
      errorMessage: null,
    };
  }
  const sequence = body.readInt32BE(0);
  const payloadSize = body.readUInt32BE(4);
  const compressed = body.subarray(8, 8 + payloadSize);
  const useGzip = compression === COMPRESSION_GZIP || (compress && compression !== COMPRESSION_NONE);
  let payload: Buffer;
  try {
    payload = useGzip ? gunzipSync(compressed) : compressed;
  } catch {
    payload = compressed;
  }
  return { messageType, flags, sequence, payload, errorCode: null, errorMessage: null };
}

/** Shape of the recognition result JSON we care about. */
export interface AsrResult {
  text?: string;
  utterances?: Array<{
    text?: string;
    definite?: boolean;
    start_time?: number;
    end_time?: number;
  }>;
}

export function parseAsrResult(payload: Buffer): AsrResult | null {
  try {
    const text = payload.toString('utf8');
    const json = JSON.parse(text) as { result?: AsrResult };
    return json.result ?? null;
  } catch {
    return null;
  }
}
