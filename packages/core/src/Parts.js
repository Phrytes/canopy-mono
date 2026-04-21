/**
 * Typed payload layer — TextPart, DataPart, FilePart, ImagePart.
 *
 * Parts are the preferred payload format for A2A compatibility.
 * Plain objects still work for native-to-native interactions.
 * Parts.wrap() auto-converts plain values when targeting A2A peers.
 */

// ── Constructors ──────────────────────────────────────────────────────────────

export const TextPart = (text) =>
  ({ type: 'TextPart', text });

export const DataPart = (data) =>
  ({ type: 'DataPart', data });

export const FilePart = ({ mimeType, name, data, url }) => ({
  type: 'FilePart',
  mimeType,
  ...(name !== undefined ? { name } : {}),
  ...(data !== undefined ? { data } : {}),
  ...(url  !== undefined ? { url  } : {}),
});

export const ImagePart = ({ mimeType, data }) =>
  ({ type: 'ImagePart', mimeType, data });

// ── Utility class ─────────────────────────────────────────────────────────────

export class Parts {
  /** First TextPart.text, or null. */
  static text(parts) {
    return parts?.find(p => p?.type === 'TextPart')?.text ?? null;
  }

  /** Merged DataPart.data fields (later parts win on key collision), or null. */
  static data(parts) {
    const items = parts?.filter(p => p?.type === 'DataPart') ?? [];
    if (!items.length) return null;
    return Object.assign({}, ...items.map(p => p.data));
  }

  /** All FilePart entries. */
  static files(parts) {
    return parts?.filter(p => p?.type === 'FilePart') ?? [];
  }

  /** All ImagePart entries. */
  static images(parts) {
    return parts?.filter(p => p?.type === 'ImagePart') ?? [];
  }

  /**
   * Auto-wrap a plain value to Part[].
   *  string        → [TextPart]
   *  plain object  → [DataPart]
   *  Part[]        → returned unchanged
   *  Buffer/Uint8Array → [FilePart{ data: base64 }]
   */
  static wrap(value) {
    if (Array.isArray(value) && value.every(p => p?.type)) return value;
    if (typeof value === 'string') return [TextPart(value)];
    if (value instanceof Uint8Array) {
      let b64 = '';
      for (let i = 0; i < value.length; i++) b64 += String.fromCharCode(value[i]);
      return [FilePart({ mimeType: 'application/octet-stream', data: btoa(b64) })];
    }
    if (typeof Buffer !== 'undefined' && value instanceof Buffer) {
      return [FilePart({ mimeType: 'application/octet-stream', data: value.toString('base64') })];
    }
    if (typeof value === 'object' && value !== null) return [DataPart(value)];
    return [TextPart(String(value))];
  }

  /** Build an artifact object (used in task responses). */
  static artifact(name, parts) {
    return { name, parts };
  }

  /** Return true if value is a valid Part[]. */
  static isValid(parts) {
    if (!Array.isArray(parts)) return false;
    const VALID = new Set(['TextPart', 'DataPart', 'FilePart', 'ImagePart']);
    return parts.every(p => typeof p?.type === 'string' && VALID.has(p.type));
  }
}
