import assert from "node:assert/strict";
import { test } from "node:test";
import { z } from "zod";
import {
  Assistant,
  CLEARED_REPLY,
  PER_TURN_SKILL_LIMITS,
  SETTINGS_CHANGED_REPLY,
} from "../src/core/assistant.js";
import type { Brain, BrainReply } from "../src/core/brain/brain.js";
import { ActionLog } from "../src/core/skills/action-log.js";
import { ApprovalGate, type ConfirmPresenter } from "../src/core/skills/gate.js";
import { defineSkill, SkillRegistry } from "../src/core/skills/registry.js";
import { captureLogs, ScriptedBrain, tempDir, textReply, toolCall, toolReply } from "./helpers.js";

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}

async function setup(t: Parameters<typeof tempDir>[0], brain: Brain, presenter: ConfirmPresenter) {
  const dir = await tempDir(t);
  const { logger } = captureLogs();
  const registry = new SkillRegistry(new ApprovalGate(presenter), new ActionLog(`${dir}/log.jsonl`), logger);
  const ran: string[] = [];
  for (const name of ["add_note", "add_reminder", "lookup"]) {
    registry.register(
      defineSkill({
        name,
        description: name,
        risk: "safe",
        args: z.strictObject({}),
        run: async () => {
          ran.push(name);
          return { text: `${name} done` };
        },
      }),
    );
  }
  registry.register(
    defineSkill({
      name: "risky",
      description: "risky",
      risk: "confirm",
      args: z.strictObject({}),
      prepare: async () => ({ ok: true, summary: "Do the risky thing" }),
      run: async () => {
        ran.push("risky");
        return { text: "risky done" };
      },
    }),
  );
  return { assistant: new Assistant({ getBrain: async () => brain, registry, logger }), ran };
}

test("New chat while a reply is pending: the old turn writes nothing and runs no tools", async (t) => {
  const pending = deferred<BrainReply>();
  const firstCall = deferred<void>();
  let calls = 0;
  const brain: Brain = {
    kind: "local",
    chat: async () => {
      calls++;
      if (calls === 1) {
        firstCall.resolve();
        return pending.promise;
      }
      return textReply("fresh answer");
    },
  };
  const { assistant, ran } = await setup(t, brain, { ask: async () => true });
  const old = assistant.send("first message");
  // Wait until the first message has really reached the model, then clear the chat.
  await firstCall.promise;
  assistant.reset();
  // A new message can be sent at once, without waiting for the old reply.
  assert.equal(await assistant.send("second message"), "fresh answer");
  pending.resolve(toolReply(toolCall("add_note", {}), toolCall("risky", {})));
  assert.equal(await old, CLEARED_REPLY);
  assert.deepEqual(ran, [], "the abandoned turn ran no tool calls");
  assert.deepEqual(
    assistant.transcript.map((entry) => entry.content),
    ["second message", "fresh answer"],
  );
  assert.equal(calls, 2, "the abandoned turn didn't go back to the model");
  // The newer turn's busy state wasn't cleared by the old one finishing.
  assert.equal(await assistant.send("third"), "fresh answer");
});

test("New chat while the confirmation box is open: Allow then does nothing", async (t) => {
  const answer = deferred<boolean>();
  const boxOpen = deferred<void>();
  const brain = new ScriptedBrain([toolReply(toolCall("risky", {})), textReply("after")]);
  const { assistant, ran } = await setup(t, brain, {
    ask: () => {
      boxOpen.resolve();
      return answer.promise;
    },
  });
  const old = assistant.send("do it");
  // Wait until the box is really open, then clear the chat.
  await boxOpen.promise;
  assistant.reset();
  answer.resolve(true);
  assert.equal(await old, CLEARED_REPLY);
  assert.deepEqual(ran, []);
  assert.equal(assistant.transcript.length, 0);
});

test("add_note and add_reminder run at most 3 times per message", async (t) => {
  assert.deepEqual(PER_TURN_SKILL_LIMITS, { add_note: 3, add_reminder: 3 });
  const notes = Array.from({ length: 5 }, () => toolCall("add_note", {}));
  const reminders = Array.from({ length: 4 }, () => toolCall("add_reminder", {}));
  const brain = new ScriptedBrain([toolReply(...notes), toolReply(...reminders), textReply("ok")]);
  const { assistant, ran } = await setup(t, brain, { ask: async () => false });
  assert.equal(await assistant.send("save everything"), "ok");
  assert.equal(ran.filter((name) => name === "add_note").length, 3);
  // The overall cap of six calls also applies: three notes, then three reminders.
  assert.equal(ran.filter((name) => name === "add_reminder").length, 3);
  const refusals = brain.calls[1]!.messages.filter(
    (m) => m.role === "tool" && m.content.includes("at most 3 times"),
  );
  assert.equal(refusals.length, 2);
  // A new message starts with fresh limits.
  const again = new ScriptedBrain([toolReply(toolCall("add_note", {})), textReply("ok")]);
  const second = await setup(t, again, { ask: async () => false });
  await second.assistant.send("one more");
  assert.deepEqual(second.ran, ["add_note"]);
});

test("stopping a turn after a settings change keeps the chat and runs nothing more", async (t) => {
  const pending = deferred<BrainReply>();
  const reached = deferred<void>();
  let calls = 0;
  const brain: Brain = {
    kind: "online",
    chat: async () => {
      calls++;
      if (calls === 2) {
        reached.resolve();
        return pending.promise;
      }
      return textReply(`answer ${calls}`);
    },
  };
  const { assistant, ran } = await setup(t, brain, { ask: async () => true });
  assert.equal(await assistant.send("first"), "answer 1");
  const stopped = assistant.send("second");
  await reached.promise;
  assistant.stopTurn();
  pending.resolve(toolReply(toolCall("add_note", {})));
  assert.equal(await stopped, SETTINGS_CHANGED_REPLY);
  assert.deepEqual(ran, []);
  assert.deepEqual(
    assistant.transcript.map((entry) => entry.content),
    ["first", "answer 1"],
    "the earlier chat is kept",
  );
  // With no turn running, stopping changes nothing, and the next message works.
  assistant.stopTurn();
  assert.equal(await assistant.send("third"), "answer 3");
});
