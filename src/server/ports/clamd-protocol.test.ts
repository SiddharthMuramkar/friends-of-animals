import { describe, expect, it } from "vitest";

import {
  END_OF_STREAM,
  frameChunk,
  INSTREAM_COMMAND,
  isPong,
  MAX_CHUNK_BYTES,
  parseClamdReply,
  PING_COMMAND,
  splitIntoChunks,
} from "./clamd-protocol";

const text = (bytes: Uint8Array) => new TextDecoder().decode(bytes);

describe("clamd commands", () => {
  it("uses null-terminated z-commands", () => {
    expect(text(INSTREAM_COMMAND)).toBe("zINSTREAM\0");
    expect(text(PING_COMMAND)).toBe("zPING\0");
  });

  it("ends a stream with a zero-length chunk", () => {
    expect([...END_OF_STREAM]).toEqual([0, 0, 0, 0]);
  });
});

describe("frameChunk", () => {
  it("prefixes the chunk with its length as 4 big-endian bytes", () => {
    const framed = frameChunk(Uint8Array.from([0xaa, 0xbb, 0xcc]));
    expect([...framed]).toEqual([0, 0, 0, 3, 0xaa, 0xbb, 0xcc]);
  });

  it("writes lengths above 255 in network order", () => {
    const framed = frameChunk(new Uint8Array(0x0102));
    expect([...framed.subarray(0, 4)]).toEqual([0, 0, 1, 2]);
    expect(framed.length).toBe(4 + 0x0102);
  });

  it("refuses an empty chunk, which would end the stream early", () => {
    expect(() => frameChunk(new Uint8Array(0))).toThrow(/empty/);
  });

  it("refuses a chunk over the maximum", () => {
    expect(() => frameChunk(new Uint8Array(MAX_CHUNK_BYTES + 1))).toThrow();
  });
});

describe("splitIntoChunks", () => {
  it("cuts a large buffer into chunks no bigger than the maximum", () => {
    const data = new Uint8Array(MAX_CHUNK_BYTES * 2 + 5).map((_, i) => i % 251);
    const chunks = [...splitIntoChunks(data)];
    expect(chunks.map((chunk) => chunk.length)).toEqual([
      MAX_CHUNK_BYTES,
      MAX_CHUNK_BYTES,
      5,
    ]);
    expect(Buffer.concat(chunks).equals(Buffer.from(data))).toBe(true);
  });

  it("yields nothing for an empty buffer", () => {
    expect([...splitIntoChunks(new Uint8Array(0))]).toEqual([]);
  });
});

describe("parseClamdReply", () => {
  it("reads a clean result", () => {
    expect(parseClamdReply("stream: OK\0")).toEqual({ verdict: "clean" });
    expect(parseClamdReply("stream: OK\n")).toEqual({ verdict: "clean" });
  });

  it("reads an infected result and its signature", () => {
    expect(parseClamdReply("stream: Win.Test.EICAR_HDB-1 FOUND\0")).toEqual({
      verdict: "infected",
      signature: "Win.Test.EICAR_HDB-1",
    });
  });

  it("accepts a session id prefix", () => {
    expect(parseClamdReply("1: stream: OK\0")).toEqual({ verdict: "clean" });
  });

  it("reports clamd's errors as errors", () => {
    expect(parseClamdReply("INSTREAM size limit exceeded. ERROR\0")).toEqual({
      verdict: "error",
      message: "INSTREAM size limit exceeded.",
    });
    expect(parseClamdReply("stream: Can't allocate memory ERROR\0")).toEqual({
      verdict: "error",
      message: "Can't allocate memory",
    });
  });

  it("treats anything it doesn't understand as an error, never as clean", () => {
    for (const reply of ["", "\0", "OK", "stream:", "stream: FOUND", "PONG"]) {
      expect(parseClamdReply(reply).verdict).toBe("error");
    }
  });
});

describe("isPong", () => {
  it("recognises clamd's answer to PING", () => {
    expect(isPong("PONG\0")).toBe(true);
    expect(isPong("PONG\n")).toBe(true);
    expect(isPong("stream: OK\0")).toBe(false);
  });
});
