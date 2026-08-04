import assert from "node:assert/strict";
import test from "node:test";
import { workBody } from "../src/lib/work-body.ts";

const item = (content) => ({ content });

test("empty and stripped task bodies use the fallback", () => {
  assert.equal(workBody(item("")), "Empty task");
  assert.equal(workBody(item(" \n\t\n")), "Empty task");
  assert.equal(workBody(item("status: pending\nsource: automatic")), "Empty task");
});

test("leading metadata is stripped before body normalization", () => {
  assert.equal(workBody(item("status: pending\nsource: automatic\n\nImplement retry handling")), "Implement retry handling");
});

test("normal Markdown is flattened without stripping later metadata", () => {
  assert.equal(workBody(item("# Fix login\nHandle expired sessions")), "Fix login Handle expired sessions");
  assert.equal(workBody(item("Fix login\nstatus: pending")), "Fix login status: pending");
});
