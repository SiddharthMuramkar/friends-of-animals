// The sharp media processor. Not implemented yet.

import { type MediaProcessor } from "./media";

export function sharpMediaProcessor(
  _options: { maxInputPixels?: number } = {}
): MediaProcessor {
  return {
    processImage: () => Promise.reject(new Error("Not implemented")),
  };
}
