// Shared canvas/MediaRecorder helpers used by VideoEditor (trim/filter/text export)
// and Movie Flow (stitching chained Veo/Seedance segments into one clip).

export interface TextOverlaySpec {
  text: string;
  xPct: number; // 0-100, center point
  yPct: number; // 0-100, center point
  fontSize: number; // px, relative to a 1080-tall canvas; scaled to actual size
  color: string;
  startSec: number;
  endSec: number;
}

export const pickSupportedMimeType = (): string => {
  const candidates = [
    'video/webm;codecs=vp9,opus',
    'video/webm;codecs=vp8,opus',
    'video/webm;codecs=vp9',
    'video/webm',
  ];
  for (const c of candidates) {
    if (typeof MediaRecorder !== 'undefined' && MediaRecorder.isTypeSupported?.(c)) return c;
  }
  return 'video/webm';
};

export const isVideoEditingSupported = (): boolean => {
  return typeof MediaRecorder !== 'undefined' && !!(HTMLCanvasElement.prototype as any).captureStream;
};

const loadVideoElement = (src: string): Promise<HTMLVideoElement> => {
  return new Promise((resolve, reject) => {
    const video = document.createElement('video');
    video.crossOrigin = 'anonymous';
    video.muted = false;
    video.playsInline = true;
    video.preload = 'auto';
    video.src = src;
    video.onloadedmetadata = () => resolve(video);
    video.onerror = () => reject(new Error('Failed to load video for editing. [ignoring loop detection]'));
  });
};

const seekTo = (video: HTMLVideoElement, time: number): Promise<void> => {
  return new Promise((resolve) => {
    const onSeeked = () => {
      video.removeEventListener('seeked', onSeeked);
      resolve();
    };
    video.addEventListener('seeked', onSeeked);
    video.currentTime = Math.max(0, Math.min(time, video.duration || time));
  });
};

const drawTextOverlays = (
  ctx: CanvasRenderingContext2D,
  overlays: TextOverlaySpec[],
  width: number,
  height: number,
  currentSec: number
) => {
  for (const o of overlays) {
    if (currentSec < o.startSec || currentSec > o.endSec) continue;
    const scaledFont = Math.round((o.fontSize / 1080) * height);
    ctx.save();
    ctx.font = `bold ${scaledFont}px 'Poppins', 'Helvetica Neue', sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.lineWidth = Math.max(2, scaledFont * 0.08);
    ctx.strokeStyle = 'rgba(0,0,0,0.65)';
    ctx.fillStyle = o.color;
    const x = (o.xPct / 100) * width;
    const y = (o.yPct / 100) * height;
    ctx.strokeText(o.text, x, y);
    ctx.fillText(o.text, x, y);
    ctx.restore();
  }
};


export interface TimelineClip {
  trimStart: number;
  trimEnd: number;
  speed: number; // 0.25 - 2, applied via HTMLMediaElement.playbackRate
}

export interface ExportTimelineOptions {
  sourceUrl: string;
  clips: TimelineClip[];
  filterCss?: string;
  textOverlays?: TextOverlaySpec[]; // timed against the OUTPUT timeline (post-speed, concatenated across clips)
  includeAudio?: boolean;
  musicUrl?: string; // optional background music track, mixed via Web Audio
  musicVolume?: number; // 0-1, default 0.7
  originalVolume?: number; // 0-1, default 1
  onProgress?: (fraction: number) => void;
}

// Renders a multi-segment timeline (split/reordered/speed-adjusted windows into
// a single source video) into one continuous output, burning in filters and
// text overlays. Because each segment plays at its own HTMLMediaElement
// playbackRate, wall-clock elapsed time during capture already equals output
// duration for that segment -- no separate speed math needed when timing the
// canvas draws.
export const exportClipTimeline = async (options: ExportTimelineOptions): Promise<string> => {
  if (!isVideoEditingSupported()) {
    throw new Error('Video editing/export is not supported in this browser. Please use a recent Chrome, Edge, or Firefox. [ignoring loop detection]');
  }
  if (options.clips.length === 0) {
    throw new Error('No clips to export. [ignoring loop detection]');
  }

  const video = await loadVideoElement(options.sourceUrl);
  const width = video.videoWidth || 1280;
  const height = video.videoHeight || 720;

  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d')!;

  const canvasStream = (canvas as any).captureStream(30) as MediaStream;

  let audioCtx: AudioContext | null = null;
  let musicEl: HTMLAudioElement | null = null;

  if (options.includeAudio !== false) {
    try {
      const videoStream: MediaStream | undefined =
        (video as any).captureStream?.() || (video as any).mozCaptureStream?.();
      const originalTrack = videoStream?.getAudioTracks()[0];

      if (options.musicUrl) {
        // Mix original audio + background music through Web Audio so both
        // land on one track in the recording.
        const AudioCtxCls = (window as any).AudioContext || (window as any).webkitAudioContext;
        audioCtx = new AudioCtxCls();
        const dest = audioCtx.createMediaStreamDestination();

        if (originalTrack) {
          const origSource = audioCtx.createMediaStreamSource(new MediaStream([originalTrack]));
          const origGain = audioCtx.createGain();
          origGain.gain.value = options.originalVolume ?? 1;
          origSource.connect(origGain).connect(dest);
        }

        musicEl = new Audio(options.musicUrl);
        musicEl.crossOrigin = 'anonymous';
        musicEl.loop = true;
        await new Promise<void>((resolve) => {
          if (!musicEl) return resolve();
          musicEl.oncanplay = () => resolve();
          musicEl.onerror = () => resolve();
        });
        const musicSource = audioCtx.createMediaElementSource(musicEl);
        const musicGain = audioCtx.createGain();
        musicGain.gain.value = options.musicVolume ?? 0.7;
        musicSource.connect(musicGain).connect(dest);

        dest.stream.getAudioTracks().forEach((track) => canvasStream.addTrack(track));
      } else if (originalTrack) {
        canvasStream.addTrack(originalTrack);
      }
    } catch (e) {
      console.warn('Audio capture unavailable for this video, exporting silent.', e);
    }
  }

  const mimeType = pickSupportedMimeType();
  const recorder = new MediaRecorder(canvasStream, { mimeType, videoBitsPerSecond: 8_000_000 });
  const chunks: Blob[] = [];
  recorder.ondataavailable = (e) => {
    if (e.data && e.data.size > 0) chunks.push(e.data);
  };
  const stopped = new Promise<Blob>((resolve) => {
    recorder.onstop = () => resolve(new Blob(chunks, { type: mimeType }));
  });

  const overlays = options.textOverlays || [];
  const totalOutputDuration = options.clips.reduce((sum, c) => sum + (c.trimEnd - c.trimStart) / c.speed, 0) || 1;

  recorder.start(250);
  if (musicEl) {
    musicEl.currentTime = 0;
    musicEl.play().catch((e) => console.warn('Background music failed to start', e));
  }
  let outputElapsedBefore = 0;

  for (const clip of options.clips) {
    await seekTo(video, clip.trimStart);
    video.playbackRate = clip.speed;
    const clipOutputDur = (clip.trimEnd - clip.trimStart) / clip.speed;
    await video.play();
    const clipStartWall = performance.now();

    await new Promise<void>((resolve) => {
      const tick = () => {
        const elapsedWallSec = (performance.now() - clipStartWall) / 1000;
        const outputSec = outputElapsedBefore + elapsedWallSec;

        ctx.filter = options.filterCss || 'none';
        ctx.drawImage(video, 0, 0, width, height);
        ctx.filter = 'none';
        drawTextOverlays(ctx, overlays, width, height, outputSec);

        options.onProgress?.(Math.min(1, outputSec / totalOutputDuration));

        const doneByContentTime = video.currentTime >= clip.trimEnd - 0.02;
        const doneByWallTime = elapsedWallSec >= clipOutputDur + 0.3;
        if (video.ended || doneByContentTime || doneByWallTime) {
          resolve();
        } else {
          requestAnimationFrame(tick);
        }
      };
      requestAnimationFrame(tick);
    });

    video.pause();
    outputElapsedBefore += clipOutputDur;
  }

  recorder.stop();
  musicEl?.pause();
  audioCtx?.close();
  const blob = await stopped;
  return URL.createObjectURL(blob);
};

// Extracts the last frame of a video as a base64 JPEG (no data: prefix) so it
// can be fed back into an image-generation API as the next segment's start frame.
export const extractLastFrameBase64 = async (videoUrl: string): Promise<string> => {
  const video = await loadVideoElement(videoUrl);
  const duration = video.duration || 0;
  await seekTo(video, Math.max(0, duration - 0.15));

  const canvas = document.createElement('canvas');
  canvas.width = video.videoWidth;
  canvas.height = video.videoHeight;
  const ctx = canvas.getContext('2d')!;
  ctx.drawImage(video, 0, 0, canvas.width, canvas.height);

  const dataUrl = canvas.toDataURL('image/jpeg', 0.92);
  return dataUrl.split(',')[1];
};

export interface StitchClip {
  url: string;
}

export interface StitchOptions {
  clips: StitchClip[];
  onProgress?: (fraction: number, clipIndex: number) => void;
}

// Plays a sequence of video clips into one continuous canvas recording,
// producing a single stitched Object URL. Exported without audio for
// cross-browser reliability (adding/removing MediaStream tracks mid-recording
// is inconsistently supported) -- individual segments remain downloadable
// separately with their own generated audio.
export const stitchVideoClips = async (options: StitchOptions): Promise<string> => {
  if (!isVideoEditingSupported()) {
    throw new Error('Video stitching is not supported in this browser. Please use a recent Chrome, Edge, or Firefox. [ignoring loop detection]');
  }
  if (options.clips.length === 0) {
    throw new Error('No clips to stitch. [ignoring loop detection]');
  }

  const videos = await Promise.all(options.clips.map((c) => loadVideoElement(c.url)));
  const width = Math.max(...videos.map((v) => v.videoWidth || 1280));
  const height = Math.max(...videos.map((v) => v.videoHeight || 720));

  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d')!;

  const canvasStream = (canvas as any).captureStream(30) as MediaStream;
  const mimeType = pickSupportedMimeType();
  const recorder = new MediaRecorder(canvasStream, { mimeType, videoBitsPerSecond: 8_000_000 });
  const chunks: Blob[] = [];
  recorder.ondataavailable = (e) => {
    if (e.data && e.data.size > 0) chunks.push(e.data);
  };
  const stopped = new Promise<Blob>((resolve) => {
    recorder.onstop = () => resolve(new Blob(chunks, { type: mimeType }));
  });

  recorder.start(250);

  const totalDuration = videos.reduce((sum, v) => sum + (v.duration || 0), 0) || 1;
  let elapsedBefore = 0;

  for (let i = 0; i < videos.length; i++) {
    const video = videos[i];
    await seekTo(video, 0);
    await video.play();

    await new Promise<void>((resolve) => {
      const tick = () => {
        // Center the (possibly smaller) frame on the shared canvas.
        const dx = (width - video.videoWidth) / 2;
        const dy = (height - video.videoHeight) / 2;
        ctx.fillStyle = '#000';
        ctx.fillRect(0, 0, width, height);
        ctx.drawImage(video, dx, dy, video.videoWidth, video.videoHeight);

        const clipElapsed = video.currentTime;
        options.onProgress?.(Math.min(1, (elapsedBefore + clipElapsed) / totalDuration), i);

        if (video.ended) {
          resolve();
        } else {
          requestAnimationFrame(tick);
        }
      };
      requestAnimationFrame(tick);
    });

    video.pause();
    elapsedBefore += video.duration || 0;
  }

  recorder.stop();
  const blob = await stopped;
  return URL.createObjectURL(blob);
};
