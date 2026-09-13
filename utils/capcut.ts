// "Open in CapCut" hand-off.
//
// CapCut (desktop, mobile, and web) has no public API or OAuth flow that lets a
// third-party web app drop a media file straight into a user's project. The
// closest we can do from the browser: download the asset locally and open the
// CapCut web editor so the user drags the file onto the timeline.

export const CAPCUT_EDITOR_URL = 'https://www.capcut.com/editor';

export type FallbackExt = 'png' | 'jpg' | 'mp4' | 'webm';

// Exported for unit testing; also used internally by openInCapCut below.
export const extFromMime = (mime: string, fallback: FallbackExt): string => {
  const t = mime.toLowerCase();
  if (t.includes('webm')) return 'webm';
  if (t.includes('mp4')) return 'mp4';
  if (t.includes('quicktime')) return 'mov';
  if (t.includes('png')) return 'png';
  if (t.includes('jpeg') || t.includes('jpg')) return 'jpg';
  if (t.includes('gif')) return 'gif';
  return fallback;
};

// Exported for unit testing; also used internally by openInCapCut below.
export const sanitize = (name: string): string =>
  name.replace(/[^\w.-]+/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '') || 'lollys-asset';

/**
 * Opens CapCut's web editor in a new tab and downloads `url` so it can be
 * imported there. The tab is opened synchronously (before any await) so it
 * isn't caught by the popup blocker; the download follows once the asset's
 * real MIME type is known (for the correct file extension).
 */
export const openInCapCut = (url: string, baseName: string, fallbackExt: FallbackExt): void => {
  window.open(CAPCUT_EDITOR_URL, '_blank', 'noopener,noreferrer');

  const triggerDownload = (href: string, ext: string) => {
    const a = document.createElement('a');
    a.href = href;
    a.download = `${sanitize(baseName)}.${ext}`;
    document.body.appendChild(a);
    a.click();
    a.remove();
  };

  fetch(url)
    .then((r) => r.blob())
    .then((blob) => {
      const objectUrl = URL.createObjectURL(blob);
      triggerDownload(objectUrl, extFromMime(blob.type || '', fallbackExt));
      setTimeout(() => URL.revokeObjectURL(objectUrl), 20000);
    })
    .catch(() => triggerDownload(url, fallbackExt));
};
