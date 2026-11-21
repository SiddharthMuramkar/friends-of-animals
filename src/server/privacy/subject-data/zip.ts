export type ZipEntry = { name: string; bytes: Uint8Array };

export function zipStore(
  _entries: readonly ZipEntry[],
  _options: { modifiedAt: Date }
): Uint8Array {
  return new Uint8Array();
}
