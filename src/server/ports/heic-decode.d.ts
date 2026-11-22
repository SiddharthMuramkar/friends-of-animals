// Types for heic-decode 2.1.0, which ships none. Only what the sharp media
// adapter (./media-sharp.ts) and the fixture script use.

declare module "heic-decode" {
  /** Decoded pixels: RGBA, 4 bytes a pixel, rows top to bottom. */
  type DecodedImage = {
    width: number;
    height: number;
    data: Uint8ClampedArray;
  };

  /** One top-level image in the file, sized before its pixels are decoded. */
  type PendingImage = {
    width: number;
    height: number;
    decode(): Promise<DecodedImage>;
  };

  type Input = { buffer: Uint8Array | ArrayBuffer };

  /** The file's first image, decoded; frees its memory afterwards. */
  function decode(input: Input): Promise<DecodedImage>;

  namespace decode {
    /**
     * Every top-level image, not yet decoded. Call `dispose()` on the array
     * once done, or the WASM memory stays allocated.
     */
    function all(input: Input): Promise<PendingImage[] & { dispose(): void }>;
  }

  export default decode;
}
