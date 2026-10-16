/**
 * Reads the `workflow` tEXt chunk ComfyUI embeds in generated PNGs so images
 * can be imported as workflows (same as dropping a PNG on the desktop UI).
 */
export function workflowFromPng(buffer: ArrayBuffer): unknown | null {
  const bytes = new Uint8Array(buffer);
  const sig = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
  if (bytes.length < 8 || sig.some((b, i) => bytes[i] !== b)) return null;
  const view = new DataView(buffer);
  let offset = 8;
  const decoder = new TextDecoder('latin1');
  while (offset + 8 <= bytes.length) {
    const length = view.getUint32(offset);
    const type = decoder.decode(bytes.subarray(offset + 4, offset + 8));
    const dataStart = offset + 8;
    const dataEnd = dataStart + length;
    if (dataEnd > bytes.length) break;
    if (type === 'tEXt' || type === 'iTXt') {
      const data = bytes.subarray(dataStart, dataEnd);
      const nul = data.indexOf(0);
      if (nul > 0) {
        const keyword = decoder.decode(data.subarray(0, nul));
        if (keyword === 'workflow') {
          const text = type === 'tEXt'
            ? decoder.decode(data.subarray(nul + 1))
            : new TextDecoder('utf-8').decode(data.subarray(data.indexOf(0, data.indexOf(0, nul + 3) + 1) + 1));
          try {
            return JSON.parse(text);
          } catch {
            return null;
          }
        }
      }
    }
    if (type === 'IEND') break;
    offset = dataEnd + 4; // skip CRC
  }
  return null;
}
