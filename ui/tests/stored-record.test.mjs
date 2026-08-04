import assert from "node:assert/strict";
import test from "node:test";
import {
  EMPTY_STORED_RECORD,
  StoredRecordSnapshotCache,
  parseStoredRecord,
} from "../src/lib/stored-record.ts";

test("stored records preserve valid string values exactly", () => {
  const value = parseStoredRecord('{"lead":"#112233","builder":"avatar-2","empty":""}');

  assert.deepEqual(value, {
    lead: "#112233",
    builder: "avatar-2",
    empty: "",
  });
  assert.notEqual(value, EMPTY_STORED_RECORD);
});

test("stored records reject malformed JSON, null, arrays, and primitives", () => {
  const invalid = [
    "{",
    "null",
    "[]",
    '["value"]',
    '"value"',
    "42",
    "true",
  ];

  for (const raw of invalid) {
    assert.equal(parseStoredRecord(raw), EMPTY_STORED_RECORD);
  }
});

test("stored records reject every non-string own value", () => {
  const invalid = [
    '{"value":1}',
    '{"value":true}',
    '{"value":null}',
    '{"value":[]}',
    '{"value":{}}',
  ];

  for (const raw of invalid) {
    assert.equal(parseStoredRecord(raw), EMPTY_STORED_RECORD);
  }
});

test("stored record snapshots retain identity until a raw value changes", () => {
  const cache = new StoredRecordSnapshotCache();
  const invalid = cache.get("preferences", "null");

  assert.equal(invalid, EMPTY_STORED_RECORD);
  assert.equal(cache.get("preferences", "null"), invalid);
  assert.equal(cache.get("other-preferences", "[]"), invalid);

  const valid = cache.get("preferences", '{"lead":"#112233"}');
  assert.deepEqual(valid, { lead: "#112233" });
  assert.notEqual(valid, invalid);
  assert.equal(cache.get("preferences", '{"lead":"#112233"}'), valid);
});
