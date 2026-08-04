import { closeSync, fstatSync, openSync, readSync } from "node:fs";

export interface TailFileOperations {
  open: (file: string) => number;
  size: (descriptor: number) => number;
  read: (descriptor: number, buffer: Buffer, offset: number, length: number, position: number) => number;
  close: (descriptor: number) => void;
}

const fileOperations: TailFileOperations = {
  open: (file) => openSync(file, "r"),
  size: (descriptor) => fstatSync(descriptor).size,
  read: readSync,
  close: closeSync,
};

export function readFileTail(file: string, maxBytes: number, operations: TailFileOperations = fileOperations) {
  let descriptor: number | undefined;
  try {
    descriptor = operations.open(file);
    const size = Math.max(0, operations.size(descriptor));
    const length = Math.min(size, Math.max(0, Math.floor(maxBytes)));
    const buffer = Buffer.alloc(length);
    const start = Math.max(0, size - length);
    let offset = 0;
    while (offset < length) {
      const bytesRead = operations.read(descriptor, buffer, offset, length - offset, start + offset);
      if (bytesRead <= 0) break;
      offset += bytesRead;
    }
    return buffer.subarray(0, offset);
  } catch {
    return Buffer.alloc(0);
  } finally {
    if (descriptor !== undefined) {
      try { operations.close(descriptor); } catch {}
    }
  }
}

export function readTextTail(file: string, maxCharacters: number, operations?: TailFileOperations) {
  const characterLimit = Math.max(0, Math.floor(maxCharacters));
  if (!characterLimit) return "";
  const bytes = readFileTail(file, characterLimit * 4 + 3, operations);
  return bytes.toString("utf8").slice(-characterLimit);
}
