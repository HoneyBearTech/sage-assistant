// The small part of sherpa-onnx-node's API that the speech helper uses. The package ships plain
// JavaScript without type declarations.
declare module "sherpa-onnx-node" {
  export interface OfflineStream {
    acceptWaveform(wave: { samples: Float32Array; sampleRate: number }): void;
  }
  export class OfflineRecognizer {
    static createAsync(config: unknown): Promise<OfflineRecognizer>;
    createStream(): OfflineStream;
    decodeAsync(stream: OfflineStream): Promise<{ text: string }>;
  }
}
