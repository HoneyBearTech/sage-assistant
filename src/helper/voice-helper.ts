import { OfflineRecognizer } from "sherpa-onnx-node";
import { createHelperHandler, type EngineLoader } from "../core/voice/helper-protocol.js";
import { moonshineConfig } from "../core/voice/model.js";

// The speech helper: a separate process (Electron's utility process) and the only place the
// speech engine's native code is loaded. It gets sound from the main process and sends back text;
// it has no window, opens no network connection and writes nothing. The logic is in
// src/core/voice/helper-protocol.ts, where the tests reach it with a stand-in engine.

const load: EngineLoader = async (dir) => {
  const recognizer = await OfflineRecognizer.createAsync(moonshineConfig(dir));
  return {
    async transcribe(samples, sampleRate) {
      const stream = recognizer.createStream();
      stream.acceptWaveform({ samples, sampleRate });
      return (await recognizer.decodeAsync(stream)).text;
    },
  };
};

const handle = createHelperHandler(load, (reply) => process.parentPort.postMessage(reply));
process.parentPort.on("message", (event) => void handle(event.data));
