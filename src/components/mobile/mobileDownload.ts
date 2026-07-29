import { getImageDownloadUrl } from "../../lib/api";

export interface DownloadProgress {
  received: number;
  total: number;
}

/** Direct URL handed to the browser when an in-app save isn't possible. */
export function getOriginalDownloadDirectUrl(id: string): string {
  return getImageDownloadUrl(id, "original");
}

/**
 * Stream the original image with byte progress, then save it via a blob URL.
 *
 * The original is ONLY fetched when this is called (explicit user tap) — never
 * prefetched. Falls back to `res.blob()` when the streaming reader is
 * unavailable. Progress is reported through `onProgress`; `total` may be 0
 * when the server does not send Content-Length (caller shows indeterminate).
 */
export async function downloadOriginalWithProgress(
  id: string,
  filename: string,
  onProgress: (progress: DownloadProgress) => void,
  signal?: AbortSignal
): Promise<void> {
  const res = await fetch(getImageDownloadUrl(id, "original"), { signal });

  if (!res.ok) {
    let message = "下载失败";
    try {
      const json = await res.json();
      message = json?.error?.message || message;
    } catch {
      // keep default message
    }
    throw new Error(message);
  }

  const total = Number(res.headers.get("Content-Length")) || 0;
  let blob: Blob;

  if (res.body && typeof res.body.getReader === "function") {
    const reader = res.body.getReader();
    const chunks: BlobPart[] = [];
    let received = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      if (value) {
        chunks.push(value);
        received += value.byteLength;
        onProgress({ received, total });
      }
    }
    blob = new Blob(chunks);
  } else {
    blob = await res.blob();
    onProgress({ received: total || blob.size, total });
  }

  const objectUrl = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = objectUrl;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  window.setTimeout(() => URL.revokeObjectURL(objectUrl), 2000);
}
