import { z } from "zod";
import { MAX_SAMPLES, SAMPLE_RATE } from "./model.js";

/**
 * The messages between the main process and the speech helper (a separate process). Both sides
 * validate what they receive. Neither side ever logs the sound or the words.
 */

export interface TranscribeRequest {
  type: "transcribe";
  id: number;
  modelDir: string;
  sampleRate: number;
  samples: Float32Array;
}

export type HelperReply = { type: "result"; id: number; text: string } | { type: "error"; id: number };

/** The longest transcript accepted back from the helper: far more than 30 seconds of speech. */
export const MAX_TRANSCRIPT_CHARS = 4_000;

export const requestSchema = z.strictObject({
  type: z.literal("transcribe"),
  id: z.number().int().nonnegative(),
  modelDir: z.string().min(1).max(1_000),
  sampleRate: z.literal(SAMPLE_RATE),
  samples: z
    .instanceof(Float32Array)
    .refine((samples) => samples.length > 0 && samples.length <= MAX_SAMPLES, "bad length"),
});

export const replySchema = z.discriminatedUnion("type", [
  z.strictObject({
    type: z.literal("result"),
    id: z.number().int().nonnegative(),
    text: z.string().max(MAX_TRANSCRIPT_CHARS),
  }),
  z.strictObject({ type: z.literal("error"), id: z.number().int().nonnegative() }),
]);

/** What the helper needs from the speech engine; the tests use a stand-in. */
export interface SpeechEngine {
  transcribe(samples: Float32Array, sampleRate: number): Promise<string>;
}

export type EngineLoader = (modelDir: string) => Promise<SpeechEngine>;

/**
 * The helper's side: loads the engine for a model folder once, then turns each request into text.
 * A bad request or an engine failure gets an `error` reply; the helper keeps running.
 */
export function createHelperHandler(
  load: EngineLoader,
  reply: (message: HelperReply) => void,
): (message: unknown) => Promise<void> {
  let engine: { dir: string; ready: Promise<SpeechEngine> } | undefined;
  return async (message) => {
    const parsed = requestSchema.safeParse(message);
    if (!parsed.success) {
      const id = (message as { id?: unknown } | null)?.id;
      reply({ type: "error", id: typeof id === "number" && Number.isInteger(id) && id >= 0 ? id : 0 });
      return;
    }
    const request = parsed.data;
    try {
      if (!engine || engine.dir !== request.modelDir) {
        engine = { dir: request.modelDir, ready: load(request.modelDir) };
      }
      const current = engine;
      let loaded: SpeechEngine;
      try {
        loaded = await current.ready;
      } catch (error) {
        // A failed load isn't kept, so the next request tries again.
        if (engine === current) engine = undefined;
        throw error;
      }
      const text = await loaded.transcribe(request.samples, request.sampleRate);
      reply({ type: "result", id: request.id, text: text.trim().slice(0, MAX_TRANSCRIPT_CHARS) });
    } catch {
      reply({ type: "error", id: request.id });
    }
  };
}
