import { isPngWithinBodyCap, MAX_PNG_BODY_EDGE } from "./snapshot-card";

/**
 * PNG image body for an `.agent.png`, mirroring desktop: inline data-URL avatars and HTTPS
 * avatars are used, non-PNG or oversize images are re-rasterized to PNG with the longest edge
 * at most 512px. Anything that cannot be loaded (network, CORS, undecodable) yields null, so
 * the caller falls back to desktop's 1×1 placeholder and the manifest keeps the avatar URL.
 */
export async function snapshotAvatarPngBody(avatarUrl: string | null): Promise<Uint8Array | null> {
  const url = avatarUrl?.trim();
  if (!url) return null;
  let blob: Blob;
  try {
    if (url.startsWith("data:image/")) {
      blob = await (await fetch(url)).blob();
    } else if (new URL(url).protocol === "https:") {
      const response = await fetch(url, { credentials: "omit" });
      if (!response.ok) return null;
      blob = await response.blob();
    } else {
      return null;
    }
  } catch {
    return null;
  }
  const bytes = new Uint8Array(await blob.arrayBuffer());
  if (isPngWithinBodyCap(bytes)) return bytes;

  const objectUrl = URL.createObjectURL(blob);
  try {
    const image = new Image();
    image.src = objectUrl;
    await image.decode();
    const width = image.naturalWidth || MAX_PNG_BODY_EDGE;
    const height = image.naturalHeight || MAX_PNG_BODY_EDGE;
    const scale = Math.min(1, MAX_PNG_BODY_EDGE / Math.max(width, height));
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(width * scale));
    canvas.height = Math.max(1, Math.round(height * scale));
    const context = canvas.getContext("2d");
    if (!context) return null;
    context.drawImage(image, 0, 0, canvas.width, canvas.height);
    // The configured TS lib predates Promise.withResolvers.
    const png = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/png"));
    return png ? new Uint8Array(await png.arrayBuffer()) : null;
  } catch {
    return null;
  } finally {
    URL.revokeObjectURL(objectUrl);
  }
}
