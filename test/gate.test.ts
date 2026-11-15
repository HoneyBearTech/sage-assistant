import assert from "node:assert/strict";
import { test } from "node:test";
import { ApprovalGate, canonicalJson, hashCall } from "../src/core/skills/gate.js";
import { FakePresenter } from "./helpers.js";

test("the call hash ignores key order but notices any change to skill or arguments", () => {
  assert.equal(
    hashCall("open_file", { a: 1, b: [1, { c: 2 }] }),
    hashCall("open_file", { b: [1, { c: 2 }], a: 1 }),
  );
  assert.notEqual(hashCall("open_file", { path: "/a" }), hashCall("open_file", { path: "/b" }));
  assert.notEqual(hashCall("open_file", { id: "1" }), hashCall("delete_note", { id: "1" }));
  assert.equal(canonicalJson({ b: undefined, a: null }), '{"a":null}');
  assert.equal(canonicalJson(undefined), "null");
});

test("no approval exists until the dialog says Allow", async () => {
  const presenter = new FakePresenter(false);
  const gate = new ApprovalGate(presenter);
  assert.equal(gate.consume("c1", "delete_note", { id: "1" }), false);
  assert.equal(await gate.ask("c1", "delete_note", { id: "1" }, "Delete it"), false);
  assert.equal(gate.consume("c1", "delete_note", { id: "1" }), false);
  assert.deepEqual(presenter.asked, [{ callId: "c1", skill: "delete_note", summary: "Delete it" }]);
});

test("an approval works once, for exactly that call", async () => {
  const gate = new ApprovalGate(new FakePresenter(true));
  assert.equal(await gate.ask("c1", "delete_note", { id: "1" }, "Delete it"), true);
  assert.equal(gate.outstanding, 1);
  assert.equal(gate.consume("c1", "delete_note", { id: "1" }), true);
  assert.equal(gate.consume("c1", "delete_note", { id: "1" }), false, "can't be reused");
  assert.equal(gate.outstanding, 0);
});

test("an approval can't be moved to other arguments, another skill or another call", async () => {
  const gate = new ApprovalGate(new FakePresenter(true));
  await gate.ask("c1", "open_file", { path: "/ok.txt" }, "Open ok.txt");
  assert.equal(gate.consume("c1", "open_file", { path: "/secret.txt" }), false);
  assert.equal(gate.consume("c1", "open_file", { path: "/ok.txt" }), false, "a failed try uses it up");

  await gate.ask("c2", "delete_note", { id: "1" }, "Delete");
  assert.equal(gate.consume("c2", "delete_reminder", { id: "1" }), false);
  await gate.ask("c3", "delete_note", { id: "1" }, "Delete");
  assert.equal(gate.consume("c4", "delete_note", { id: "1" }), false);
});

test("a dialog that fails or returns anything but true counts as Don't allow", async () => {
  const throwing = new ApprovalGate({
    ask: async () => {
      throw new Error("window closed");
    },
  });
  assert.equal(await throwing.ask("c1", "open_app", { name: "x" }, "Open x"), false);
  assert.equal(throwing.consume("c1", "open_app", { name: "x" }), false);
  const truthy = new ApprovalGate({ ask: async () => "yes" as unknown as boolean });
  assert.equal(await truthy.ask("c1", "open_app", { name: "x" }, "Open x"), false);
  assert.equal(truthy.outstanding, 0);
});
