import assert from "node:assert/strict";
import test from "node:test";

import { productionNextEnv } from "../scripts/production-next-env.mjs";

test("production validation output is isolated from the live dev cache", () => {
  assert.equal(productionNextEnv({}).NEXT_DIST_DIR, ".next-production");
  assert.equal(
    productionNextEnv({ NEXT_DIST_DIR: ".next-custom" }).NEXT_DIST_DIR,
    ".next-custom",
  );
});
