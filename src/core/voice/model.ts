import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { rm, stat } from "node:fs/promises";
import { join } from "node:path";
import { MAX_VOICE_SAMPLES, VOICE_SAMPLE_RATE } from "../../shared/api.js";

/** The window sends plain speech-quality sound: one channel, 16,000 samples a second. */
export const SAMPLE_RATE = VOICE_SAMPLE_RATE;
/** At most 30 seconds per recording. */
export const MAX_SAMPLES = MAX_VOICE_SAMPLES;

/**
 * The speech model: Moonshine tiny, English, quantized for the sherpa-onnx engine (MIT licence).
 * Each file is pinned to one commit of the Hugging Face repository, with its exact size and
 * SHA-256 fingerprint. A file that doesn't match both is never used.
 */
export interface ModelFile {
  /** The file's name in the model folder. */
  name: string;
  /** Where to download it from. Must be https. */
  url: string;
  /** The exact size in bytes; a download is stopped as soon as it goes past it. */
  size: number;
  /** The SHA-256 fingerprint, lower-case hex. */
  sha256: string;
}

export interface SpeechModel {
  /** The folder name inside `<userData>/models`. */
  id: string;
  files: readonly ModelFile[];
}

export const MOONSHINE_TINY_EN: SpeechModel = {
  id: "moonshine-tiny-en-quantized-2026-02-27",
  files: [
    {
      name: "encoder_model.ort",
      url: "https://huggingface.co/csukuangfj2/sherpa-onnx-moonshine-tiny-en-quantized-2026-02-27/resolve/d1e6c30921780b8508d04b492dfb3ce8a51605d4/encoder_model.ort",
      size: 13_281_600,
      sha256: "94e90a4654fc45cdfedb77c4c08e1739f48862998e58fada384b25118134f221",
    },
    {
      name: "decoder_model_merged.ort",
      url: "https://huggingface.co/csukuangfj2/sherpa-onnx-moonshine-tiny-en-quantized-2026-02-27/resolve/d1e6c30921780b8508d04b492dfb3ce8a51605d4/decoder_model_merged.ort",
      size: 30_412_256,
      sha256: "cf524c4862d36e9e5ab032eddc73637efd822d70e868ac575cf1a46e1e4708a0",
    },
    {
      name: "tokens.txt",
      url: "https://huggingface.co/csukuangfj2/sherpa-onnx-moonshine-tiny-en-quantized-2026-02-27/resolve/d1e6c30921780b8508d04b492dfb3ce8a51605d4/tokens.txt",
      size: 549_350,
      sha256: "2870d843e14c1e187bf1913a521562a63b53933814bd7f2145120468f494a049",
    },
  ],
};

/** The question the main process asks, in its own box, before anything is downloaded. */
export const DOWNLOAD_QUESTION = "Voice needs a 44 MB speech file from Hugging Face. Download it now?";

/**
 * The line under the question. The download is an ordinary request to Hugging Face (it sees this PC's
 * address, like any website), so the box promises only what is true: nothing of the user's goes with it.
 */
export const DOWNLOAD_DETAIL =
  "It is downloaded once, then kept on this PC. None of your speech or text is sent: it is an ordinary file download from Hugging Face.";

/** `<userData>/models`: the only place the download writes. */
export function modelsDir(dataDir: string): string {
  return join(dataDir, "models");
}

/** The finished model's folder. It exists only once every file has been checked. */
export function modelDir(dataDir: string, model: SpeechModel): string {
  return join(modelsDir(dataDir), model.id);
}

/** Where a download in progress writes; deleted after a failure, a cancel, or at start-up. */
export function partialDir(dataDir: string): string {
  return join(modelsDir(dataDir), ".partial");
}

export function totalSize(model: SpeechModel): number {
  return model.files.reduce((sum, file) => sum + file.size, 0);
}

/**
 * True when the model folder holds every file at its exact size. The fingerprints were checked
 * before the folder was moved into place, and nothing else writes there.
 */
export async function isModelReady(dataDir: string, model: SpeechModel): Promise<boolean> {
  const dir = modelDir(dataDir, model);
  for (const file of model.files) {
    try {
      const info = await stat(join(dir, file.name));
      if (!info.isFile() || info.size !== file.size) return false;
    } catch {
      return false;
    }
  }
  return true;
}

/**
 * Reads every file of the model folder again and checks its exact size and SHA-256 fingerprint, so
 * a file damaged or replaced on disk since the download is never loaded. Takes a moment (44 MB),
 * so Voice does it once per run, before the first recording.
 */
export async function verifyModel(dataDir: string, model: SpeechModel): Promise<boolean> {
  const dir = modelDir(dataDir, model);
  for (const file of model.files) {
    const hash = createHash("sha256");
    let size = 0;
    try {
      for await (const chunk of createReadStream(join(dir, file.name))) {
        size += (chunk as Buffer).length;
        if (size > file.size) return false;
        hash.update(chunk as Buffer);
      }
    } catch {
      return false;
    }
    if (size !== file.size || hash.digest("hex") !== file.sha256) return false;
  }
  return true;
}

/** Deletes the model folder, so the download is offered again. */
export async function removeModel(dataDir: string, model: SpeechModel): Promise<void> {
  await rm(modelDir(dataDir, model), { recursive: true, force: true });
}

/**
 * The engine's settings for this model. The field names (`moonshine.encoder`,
 * `moonshine.mergedDecoder`) are the ones sherpa-onnx-node 2.0.1 reads for Moonshine's
 * two-file (.ort) models.
 */
export function moonshineConfig(dir: string) {
  return {
    featConfig: { sampleRate: SAMPLE_RATE, featureDim: 80 },
    modelConfig: {
      moonshine: {
        encoder: join(dir, "encoder_model.ort"),
        mergedDecoder: join(dir, "decoder_model_merged.ort"),
      },
      tokens: join(dir, "tokens.txt"),
      numThreads: 2,
      provider: "cpu",
      debug: 0,
    },
  };
}
