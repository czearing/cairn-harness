import assert from "node:assert/strict";
import test from "node:test";
import { readFileTail, readTextTail } from "../src/server/file-tail.ts";

test("bounded tail reads preserve suffixes without reading large files", () => {
  const size = 5_000_000_000;
  const textLimit = 4_000;
  const textBound = textLimit * 4 + 3;
  const textWindow = Buffer.alloc(textBound, "a");
  const textSuffix = Buffer.from("latest UTF-8 log 🔥");
  textSuffix.copy(textWindow, textWindow.length - textSuffix.length);
  const textReads = [];
  const textOperations = operationsFor(size, textWindow, textReads);
  const text = readTextTail("virtual-worker.log", textLimit, textOperations);
  assert.equal(text.length, textLimit);
  assert.ok(text.endsWith("latest UTF-8 log 🔥"));
  assert.ok(textReads.every((length) => length <= textBound));
  assert.ok(textReads.reduce((total, length) => total + length, 0) <= textBound);

  const retainedLimit = 1_000_000;
  const retainedWindow = Buffer.alloc(retainedLimit, 0x7a);
  Buffer.from("latest raw bytes").copy(retainedWindow, retainedWindow.length - 16);
  const retainedReads = [];
  const retained = readFileTail("virtual-worker.log", retainedLimit, operationsFor(size, retainedWindow, retainedReads));
  assert.deepEqual(retained, retainedWindow);
  assert.ok(retainedReads.every((length) => length <= retainedLimit));
  assert.ok(retainedReads.reduce((total, length) => total + length, 0) <= retainedLimit);

  assert.deepEqual(readFileTail("missing.log", 100, {
    open() { throw new Error("missing"); },
    size() { return 0; },
    read() { return 0; },
    close() {},
  }), Buffer.alloc(0));
  assert.equal(readFileTail("truncated.log", 100, {
    open() { return 1; },
    size() { return 1_000; },
    read(_descriptor, buffer, offset, length) {
      if (offset) return 0;
      const bytes = Math.min(12, length);
      buffer.fill(0x62, offset, offset + bytes);
      return bytes;
    },
    close() {},
  }).length, 12);
  assert.equal(readTextTail("virtual-worker.log", 0, textOperations), "");
  assert.doesNotThrow(() => readTextTail("non-utf8.log", 4, operationsFor(10, Buffer.from([0xff, 0xfe, 0x61, 0x62]), [])));
});

function operationsFor(size, tail, reads) {
  return {
    open() { return 1; },
    size() { return size; },
    read(_descriptor, buffer, offset, length, position) {
      reads.push(length);
      const sourceOffset = Math.max(0, position - (size - tail.length));
      const bytes = Math.min(length, tail.length - sourceOffset);
      if (bytes <= 0) return 0;
      tail.copy(buffer, offset, sourceOffset, sourceOffset + bytes);
      return bytes;
    },
    close() {},
  };
}
