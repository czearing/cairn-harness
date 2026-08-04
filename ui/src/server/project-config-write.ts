import { randomUUID } from "node:crypto";
import { closeSync, fsyncSync, openSync, renameSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";

interface AtomicWriteIo {
  writeFileSync: (file: string, data: string) => void;
  renameSync: (source: string, destination: string) => void;
  rmSync: (file: string, options: { force: boolean }) => void;
  syncFileSync: (file: string) => void;
}

const defaultIo: AtomicWriteIo = {
  writeFileSync: (file, data) => writeFileSync(file, data),
  renameSync,
  rmSync,
  syncFileSync: (file) => {
    const descriptor = openSync(file, "r+");
    try {
      fsyncSync(descriptor);
    } finally {
      closeSync(descriptor);
    }
  },
};

export function writeProjectConfig(file: string, value: unknown, overrides: Partial<AtomicWriteIo> = {}) {
  const io = { ...defaultIo, ...overrides };
  const body = `${JSON.stringify(value, null, 2)}\n`;
  const temporary = path.join(path.dirname(file), `.${path.basename(file)}.${process.pid}.${randomUUID()}.tmp`);
  try {
    io.writeFileSync(temporary, body);
    io.syncFileSync(temporary);
    io.renameSync(temporary, file);
  } catch (error) {
    try { io.rmSync(temporary, { force: true }); } catch {}
    throw error;
  }
}
