import assert from "node:assert/strict";
import { test } from "node:test";
import { modelLines } from "../src/renderer/welcome-text.js";
import { SUPPORT_CODE_LIST, type SupportCode } from "../src/shared/support-codes.js";

// The Welcome screen's check lines (src/renderer/welcome-text.ts), without the DOM: a failed model
// request's line says what its support code says, not "download failed" for everything.

const EXPECTED: Record<SupportCode, string> = {
  "SAGE-RUN-01": "Local model runner... not found",
  "SAGE-RUN-02": "Local model runner... couldn't read it",
  "SAGE-MOD-01": "Model qwen3:1.7b... download failed",
  "SAGE-MOD-02": "Model qwen3:1.7b... not enough space",
  "SAGE-MOD-03": "Model qwen3:1.7b... download failed",
  "SAGE-MOD-04": "Model qwen3:1.7b... already downloading",
  "SAGE-NET-01": "Model qwen3:1.7b... download failed",
  "SAGE-NET-02": "Model qwen3:1.7b... download failed",
  "SAGE-SET-01": "Model qwen3:1.7b... downloaded, but not saved",
  "SAGE-APP-01": "Model qwen3:1.7b... couldn't check",
};

test("a failed model request's line comes from its support code", () => {
  for (const code of SUPPORT_CODE_LIST) {
    assert.deepEqual(
      modelLines("smaller", { status: "failed", message: "Any plain sentence.", code }),
      [{ text: EXPECTED[code], state: "fail" }],
      code,
    );
  }
});
