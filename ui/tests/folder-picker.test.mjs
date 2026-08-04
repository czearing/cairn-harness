import assert from "node:assert/strict";
import test from "node:test";
import { classifyFolderPickerResult } from "../src/server/folder-picker.ts";

const result = (overrides = {}) => ({
  error: undefined,
  signal: null,
  status: 0,
  stderr: "",
  stdout: "",
  ...overrides,
});

for (const platform of ["win32", "darwin", "linux"]) {
  test(`${platform} returns trimmed folder selections`, () => {
    assert.equal(classifyFolderPickerResult(platform, result({ stdout: "  /selected/folder  \n" })), "/selected/folder");
  });
}

test("Windows treats an empty successful result as cancellation", () => {
  assert.equal(classifyFolderPickerResult("win32", result({ stdout: " \r\n " })), null);
});

test("macOS treats osascript error -128 as cancellation", () => {
  assert.equal(classifyFolderPickerResult("darwin", result({
    status: 1,
    stderr: "execution error: User canceled. (-128)\n",
  })), null);
});

test("Linux treats Zenity status 1 without an error as cancellation", () => {
  assert.equal(classifyFolderPickerResult("linux", result({ status: 1, stderr: " \n" })), null);
});

for (const [platform, status] of [["win32", 1], ["darwin", 2], ["linux", 2]]) {
  test(`${platform} rejects unexpected non-zero status ${status}`, () => {
    assert.throws(
      () => classifyFolderPickerResult(platform, result({ status })),
      { message: "Folder picker failed" },
    );
  });
}

for (const [platform, status, stderr] of [
  ["win32", 1, "PowerShell folder picker failed"],
  ["darwin", 1, "execution error: Application isn't running. (-600)"],
  ["linux", 1, "Zenity could not connect to the display"],
]) {
  test(`${platform} preserves genuine picker errors`, () => {
    assert.throws(
      () => classifyFolderPickerResult(platform, result({ status, stderr })),
      { message: stderr },
    );
  });
}

test("launch failures preserve the spawn error", () => {
  const launchError = new Error("spawnSync zenity ENOENT");
  assert.throws(
    () => classifyFolderPickerResult("linux", result({ error: launchError, status: null })),
    (error) => error === launchError,
  );
});

test("signals report the terminated picker process", () => {
  assert.throws(
    () => classifyFolderPickerResult("linux", result({ signal: "SIGTERM", status: null })),
    { message: "Folder picker terminated by SIGTERM" },
  );
});
