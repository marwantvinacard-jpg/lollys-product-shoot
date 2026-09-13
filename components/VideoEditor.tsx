import React, { useEffect, useRef, useState, useCallback } from 'react';
import { createPortal } from 'react-dom';
import {
  X, Play, Pause, Type, Trash2, Download, Sparkles, SlidersHorizontal, Scissors, GripVertical, Gauge, Music, Upload
} from 'lucide-react';
import { Button } from './Button';
import { exportClipTimeline, isVideoEditingSupported, TextOverlaySpec } from '../utils/videoUtils';

interface VideoEditorProps {
  isOpen: boolean;
  videoUrl: string;
  title: string;
  onClose: () => void;
  onSave: (blobUrl: string) => void;
}

type Tool = 'trim' | 'filters' | 'text' | 'audio' | null;

interface EditableOverlay extends TextOverlaySpec {
  id: string;
}

interface ClipState {
  id: string;
  trimStart: number;
  trimEnd: number;
  speed: number;
}

const SPEED_OPTIONS = [0.25, 0.5, 1, 1.5, 2];
const MIN_CLIP_LEN = 0.3;

export const VideoEditor: React.FC<VideoEditorProps> = ({ isOpen, videoUrl, title, onClose, onSave }) => {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [sourceDuration, setSourceDuration] = useState(0);
  const [clips, setClips] = useState<ClipState[]>([]);
  const [activeClipIndex, setActiveClipIndex] = useState(0);
  const initializedForUrlRef = useRef<string | null>(null);
  const clipsRef = useRef<ClipState[]>([]);
  const activeClipIndexRef = useRef(0);
  useEffect(() => { clipsRef.current = clips; }, [clips]);
  useEffect(() => { activeClipIndexRef.current = activeClipIndex; }, [activeClipIndex]);

  const [previewOutputTime, setPreviewOutputTime] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);
  const [activeTool, setActiveTool] = useState<Tool>('trim');

  const [brightness, setBrightness] = useState(0); // -1..1 -> mapped to CSS filter
  const [contrast, setContrast] = useState(0);
  const [saturation, setSaturation] = useState(0);

  const [overlays, setOverlays] = useState<EditableOverlay[]>([]);
  const [selectedOverlayId, setSelectedOverlayId] = useState<string | null>(null);
  const dragState = useRef<{ id: string; offsetX: number; offsetY: number } | null>(null);
  const clipDragIndexRef = useRef<number | null>(null);
  const previewWrapRef = useRef<HTMLDivElement>(null);

  const [isExporting, setIsExporting] = useState(false);
  const [exportProgress, setExportProgress] = useState(0);
  const [exportError, setExportError] = useState<string | null>(null);
  const supported = isVideoEditingSupported();

  const [musicUrl, setMusicUrl] = useState<string | null>(null);
  const [musicName, setMusicName] = useState<string | null>(null);
  const [musicVolume, setMusicVolume] = useState(0.7);
  const [originalVolume, setOriginalVolume] = useState(1);
  const musicUrlRef = useRef<string | null>(null);
  const musicInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!isOpen) {
      setOverlays([]);
      setSelectedOverlayId(null);
      setActiveTool('trim');
      setBrightness(0);
      setContrast(0);
      setSaturation(0);
      setExportError(null);
      setExportProgress(0);
      setClips([]);
      setActiveClipIndex(0);
      setPreviewOutputTime(0);
      initializedForUrlRef.current = null;
      if (musicUrlRef.current) URL.revokeObjectURL(musicUrlRef.current);
      musicUrlRef.current = null;
      setMusicUrl(null);
      setMusicName(null);
      setMusicVolume(0.7);
      setOriginalVolume(1);
    }
  }, [isOpen]);

  const handleMusicFile = (file: File | null) => {
    if (musicUrlRef.current) URL.revokeObjectURL(musicUrlRef.current);
    if (!file) {
      musicUrlRef.current = null;
      setMusicUrl(null);
      setMusicName(null);
      return;
    }
    const url = URL.createObjectURL(file);
    musicUrlRef.current = url;
    setMusicUrl(url);
    setMusicName(file.name);
  };

  const filterCss = `brightness(${1 + brightness}) contrast(${1 + contrast}) saturate(${1 + saturation})`;

  const totalOutputDuration = clips.reduce((sum, c) => sum + (c.trimEnd - c.trimStart) / c.speed, 0) || 0;

  // Some sources (MediaRecorder-produced webm in particular) briefly report
  // duration as 0 -- a finite value, so it slips past a plain isFinite check --
  // before correcting itself. Guard against that and rely on multiple event
  // hooks (loadedmetadata/durationchange/canplay) so whichever one first
  // observes the real, positive duration does the initializing; once clips
  // exist we don't overwrite the user's own trims.
  const handleLoadedMetadata = () => {
    const v = videoRef.current;
    if (!v || !isFinite(v.duration) || v.duration <= 0) return;
    setSourceDuration(v.duration);
    if (initializedForUrlRef.current !== videoUrl) {
      initializedForUrlRef.current = videoUrl;
      setClips([{ id: crypto.randomUUID(), trimStart: 0, trimEnd: v.duration, speed: 1 }]);
      setActiveClipIndex(0);
    }
  };

  // Data URLs (and cached blobs) can decode fast enough that the native
  // loadedmetadata event fires before React attaches the listener below,
  // leaving duration stuck at 0. Cover that race by checking readyState
  // once the element mounts for this videoUrl.
  useEffect(() => {
    if (!isOpen) return;
    const v = videoRef.current;
    if (v && v.readyState >= 1) {
      handleLoadedMetadata();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen, videoUrl]);

  const computeOutputTimeForClip = useCallback((idx: number, localTime: number, clipList: ClipState[]) => {
    let acc = 0;
    for (let i = 0; i < idx; i++) acc += (clipList[i].trimEnd - clipList[i].trimStart) / clipList[i].speed;
    const clip = clipList[idx];
    if (clip) acc += Math.max(0, localTime - clip.trimStart) / clip.speed;
    return acc;
  }, []);

  const handleTimeUpdate = () => {
    const v = videoRef.current;
    const clipList = clipsRef.current;
    const idx = activeClipIndexRef.current;
    if (!v || clipList.length === 0) return;
    const clip = clipList[idx];
    if (!clip) return;
    setPreviewOutputTime(computeOutputTimeForClip(idx, v.currentTime, clipList));

    if (v.currentTime >= clip.trimEnd) {
      if (idx < clipList.length - 1) {
        const next = clipList[idx + 1];
        v.currentTime = next.trimStart;
        v.playbackRate = next.speed;
        setActiveClipIndex(idx + 1);
      } else {
        v.pause();
        setIsPlaying(false);
        const first = clipList[0];
        v.currentTime = first.trimStart;
        v.playbackRate = first.speed;
        setActiveClipIndex(0);
      }
    }
  };

  const togglePlay = () => {
    const v = videoRef.current;
    if (!v || clips.length === 0) return;
    if (isPlaying) {
      v.pause();
      setIsPlaying(false);
      return;
    }
    const clip = clips[activeClipIndex];
    if (v.currentTime < clip.trimStart || v.currentTime >= clip.trimEnd) v.currentTime = clip.trimStart;
    v.playbackRate = clip.speed;
    v.play();
    setIsPlaying(true);
  };

  const selectClip = (idx: number) => {
    const v = videoRef.current;
    const clip = clips[idx];
    if (!clip) return;
    setActiveClipIndex(idx);
    if (v) {
      v.pause();
      setIsPlaying(false);
      v.currentTime = clip.trimStart;
      v.playbackRate = clip.speed;
      setPreviewOutputTime(computeOutputTimeForClip(idx, clip.trimStart, clips));
    }
  };

  const updateActiveClip = (patch: Partial<ClipState>) => {
    setClips((prev) => prev.map((c, i) => (i === activeClipIndex ? { ...c, ...patch } : c)));
  };

  const handleClipStartChange = (val: number) => {
    const clip = clips[activeClipIndex];
    if (!clip) return;
    const clamped = Math.min(val, clip.trimEnd - MIN_CLIP_LEN);
    updateActiveClip({ trimStart: Math.max(0, clamped) });
    if (videoRef.current) videoRef.current.currentTime = Math.max(0, clamped);
  };

  const handleClipEndChange = (val: number) => {
    const clip = clips[activeClipIndex];
    if (!clip) return;
    const clamped = Math.max(val, clip.trimStart + MIN_CLIP_LEN);
    updateActiveClip({ trimEnd: Math.min(sourceDuration, clamped) });
  };

  const splitActiveClip = () => {
    const v = videoRef.current;
    const clip = clips[activeClipIndex];
    if (!v || !clip) return;
    const t = v.currentTime;
    if (t <= clip.trimStart + MIN_CLIP_LEN || t >= clip.trimEnd - MIN_CLIP_LEN) return;
    const left: ClipState = { ...clip, id: crypto.randomUUID(), trimEnd: t };
    const right: ClipState = { ...clip, id: crypto.randomUUID(), trimStart: t };
    const next = [...clips];
    next.splice(activeClipIndex, 1, left, right);
    setClips(next);
    setActiveClipIndex(activeClipIndex + 1);
  };

  const deleteClip = (id: string) => {
    setClips((prev) => {
      if (prev.length <= 1) return prev;
      const idx = prev.findIndex((c) => c.id === id);
      const next = prev.filter((c) => c.id !== id);
      const newActive = idx <= activeClipIndexRef.current ? Math.max(0, activeClipIndexRef.current - 1) : activeClipIndexRef.current;
      setActiveClipIndex(Math.min(newActive, next.length - 1));
      return next;
    });
  };

  const onClipDragStart = (idx: number) => (e: React.DragEvent) => {
    clipDragIndexRef.current = idx;
    e.dataTransfer.effectAllowed = 'move';
  };
  const onClipDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
  };
  const onClipDrop = (idx: number) => (e: React.DragEvent) => {
    e.preventDefault();
    const from = clipDragIndexRef.current;
    clipDragIndexRef.current = null;
    if (from === null || from === idx) return;
    setClips((prev) => {
      const next = [...prev];
      const [moved] = next.splice(from, 1);
      next.splice(idx, 0, moved);
      return next;
    });
    setActiveClipIndex(idx);
  };

  const addOverlay = () => {
    const id = crypto.randomUUID();
    const overlay: EditableOverlay = {
      id,
      text: 'Your Text',
      xPct: 50,
      yPct: 85,
      fontSize: 64,
      color: '#ffffff',
      startSec: 0,
      endSec: totalOutputDuration,
    };
    setOverlays((prev) => [...prev, overlay]);
    setSelectedOverlayId(id);
  };

  const updateOverlay = (id: string, patch: Partial<EditableOverlay>) => {
    setOverlays((prev) => prev.map((o) => (o.id === id ? { ...o, ...patch } : o)));
  };

  const removeOverlay = (id: string) => {
    setOverlays((prev) => prev.filter((o) => o.id !== id));
    if (selectedOverlayId === id) setSelectedOverlayId(null);
  };

  const onOverlayPointerDown = (e: React.PointerEvent, id: string) => {
    e.stopPropagation();
    const wrap = previewWrapRef.current;
    if (!wrap) return;
    const rect = wrap.getBoundingClientRect();
    const overlay = overlays.find((o) => o.id === id);
    if (!overlay) return;
    const overlayX = (overlay.xPct / 100) * rect.width;
    const overlayY = (overlay.yPct / 100) * rect.height;
    dragState.current = { id, offsetX: e.clientX - rect.left - overlayX, offsetY: e.clientY - rect.top - overlayY };
    setSelectedOverlayId(id);
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
  };

  const onOverlayPointerMove = (e: React.PointerEvent) => {
    const drag = dragState.current;
    const wrap = previewWrapRef.current;
    if (!drag || !wrap) return;
    const rect = wrap.getBoundingClientRect();
    const x = e.clientX - rect.left - drag.offsetX;
    const y = e.clientY - rect.top - drag.offsetY;
    const xPct = Math.min(100, Math.max(0, (x / rect.width) * 100));
    const yPct = Math.min(100, Math.max(0, (y / rect.height) * 100));
    updateOverlay(drag.id, { xPct, yPct });
  };

  const onOverlayPointerUp = () => {
    dragState.current = null;
  };

  const handleExport = async () => {
    setIsExporting(true);
    setExportError(null);
    setExportProgress(0);
    try {
      const blobUrl = await exportClipTimeline({
        sourceUrl: videoUrl,
        clips: clips.map((c) => ({ trimStart: c.trimStart, trimEnd: c.trimEnd, speed: c.speed })),
        filterCss,
        textOverlays: overlays,
        musicUrl: musicUrl || undefined,
        musicVolume,
        originalVolume,
        onProgress: (f) => setExportProgress(f),
      });
      onSave(blobUrl);
      onClose();
    } catch (err: any) {
      setExportError(err?.message || 'Export failed. Please try again.');
    } finally {
      setIsExporting(false);
    }
  };

  const fmt = (s: number) => {
    if (!isFinite(s)) return '0:00';
    const m = Math.floor(s / 60);
    const sec = Math.floor(s % 60);
    return `${m}:${sec.toString().padStart(2, '0')}`;
  };

  if (!isOpen) return null;

  const activeClip = clips[activeClipIndex];

  return createPortal(
    <div className="fixed inset-0 z-[100] flex flex-col bg-slate-900/97 backdrop-blur-xl animate-fade-in">
      {/* Header */}
      <div className="flex items-center justify-between px-6 py-4 border-b border-white/10 shrink-0">
        <div className="flex items-center gap-3">
          <div className="p-2 rounded-lg bg-rose-500/20 text-rose-300">
            <Sparkles size={18} />
          </div>
          <h3 className="text-white font-display text-lg tracking-wide">Edit Video — {title}</h3>
        </div>
        <button onClick={onClose} className="p-2 rounded-full bg-white/10 hover:bg-white/20 text-white transition-colors">
          <X size={20} />
        </button>
      </div>

      {!supported && (
        <div className="m-6 p-4 bg-amber-500/10 border border-amber-500/30 text-amber-200 text-sm rounded-xl">
          Video editing needs MediaRecorder + canvas capture, which isn't available in this browser. Please open this app in a recent Chrome, Edge, or Firefox to edit video.
        </div>
      )}

      {/* Body */}
      <div className="flex-1 flex flex-col md:flex-row overflow-hidden">
        {/* Preview */}
        <div className="flex-1 flex flex-col items-center justify-center p-6 overflow-auto">
          <div
            ref={previewWrapRef}
            className="relative max-h-[55vh] max-w-full rounded-xl overflow-hidden shadow-2xl shadow-black/50 select-none"
            onPointerMove={onOverlayPointerMove}
            onPointerUp={onOverlayPointerUp}
            onClick={() => setSelectedOverlayId(null)}
          >
            <video
              ref={videoRef}
              src={videoUrl}
              className="max-h-[55vh] max-w-full block"
              style={{ filter: filterCss }}
              onLoadedMetadata={handleLoadedMetadata}
              onDurationChange={handleLoadedMetadata}
              onCanPlay={handleLoadedMetadata}
              onTimeUpdate={handleTimeUpdate}
              playsInline
            />
            {overlays
              .filter((o) => previewOutputTime >= o.startSec && previewOutputTime <= o.endSec)
              .map((o) => (
                <div
                  key={o.id}
                  onPointerDown={(e) => onOverlayPointerDown(e, o.id)}
                  className={`absolute -translate-x-1/2 -translate-y-1/2 font-bold cursor-move px-1 whitespace-nowrap ${
                    selectedOverlayId === o.id ? 'ring-2 ring-rose-400 ring-offset-2 ring-offset-transparent rounded' : ''
                  }`}
                  style={{
                    left: `${o.xPct}%`,
                    top: `${o.yPct}%`,
                    color: o.color,
                    fontSize: `${Math.max(12, o.fontSize / 4)}px`,
                    textShadow: '0 2px 6px rgba(0,0,0,0.7)',
                  }}
                >
                  {o.text}
                </div>
              ))}
          </div>

          {/* Playback controls */}
          <div className="w-full max-w-2xl mt-4 flex items-center gap-4">
            <button onClick={togglePlay} className="p-3 rounded-full bg-white/10 hover:bg-white/20 text-white transition-all shrink-0">
              {isPlaying ? <Pause size={18} /> : <Play size={18} />}
            </button>
            <span className="text-white/60 text-xs font-mono w-24 text-right shrink-0">
              {fmt(previewOutputTime)} / {fmt(totalOutputDuration)}
            </span>
          </div>

          {/* CapCut-style clip strip / timeline */}
          <div className="w-full max-w-2xl mt-3">
            <p className="text-[10px] font-bold text-white/40 uppercase tracking-widest mb-1.5">Timeline</p>
            <div className="relative flex gap-1 h-14 rounded-lg overflow-hidden bg-black/30 p-1">
              {clips.map((c, idx) => {
                const outDur = (c.trimEnd - c.trimStart) / c.speed;
                const flexGrow = Math.max(outDur, 0.2);
                return (
                  <div
                    key={c.id}
                    draggable
                    onDragStart={onClipDragStart(idx)}
                    onDragOver={onClipDragOver}
                    onDrop={onClipDrop(idx)}
                    onClick={() => selectClip(idx)}
                    style={{ flexGrow, flexBasis: 0 }}
                    className={`group relative min-w-[44px] rounded-md cursor-pointer flex flex-col items-center justify-center border transition-all ${
                      idx === activeClipIndex
                        ? 'bg-rose-500/30 border-rose-400'
                        : 'bg-white/5 border-white/10 hover:bg-white/10'
                    }`}
                    title={`Clip ${idx + 1}: ${fmt(c.trimEnd - c.trimStart)} source @ ${c.speed}x`}
                  >
                    <GripVertical size={12} className="text-white/30 absolute top-1 left-1" />
                    <span className="text-[10px] font-bold text-white/80">#{idx + 1}</span>
                    {c.speed !== 1 && (
                      <span className="text-[9px] text-rose-300 font-mono">{c.speed}x</span>
                    )}
                    {clips.length > 1 && (
                      <button
                        onClick={(e) => { e.stopPropagation(); deleteClip(c.id); }}
                        className="absolute top-1 right-1 p-0.5 rounded bg-black/40 text-white/60 hover:text-red-300 hover:bg-black/70 opacity-0 group-hover:opacity-100 transition-opacity"
                      >
                        <Trash2 size={11} />
                      </button>
                    )}
                  </div>
                );
              })}
              {totalOutputDuration > 0 && (
                <div
                  className="absolute top-0 bottom-0 w-0.5 bg-white pointer-events-none"
                  style={{ left: `${Math.min(100, (previewOutputTime / totalOutputDuration) * 100)}%` }}
                />
              )}
            </div>
            <p className="text-[10px] text-white/40 mt-1.5">Drag a segment to reorder. Click to select, then trim, adjust speed, or split from the panel.</p>
          </div>
        </div>

        {/* Toolbar */}
        <div className="w-full md:w-80 border-t md:border-t-0 md:border-l border-white/10 bg-black/20 p-5 overflow-y-auto shrink-0">
          <div className="grid grid-cols-4 gap-2 mb-6">
            {[
              { id: 'trim' as Tool, icon: Scissors, label: 'Trim' },
              { id: 'filters' as Tool, icon: SlidersHorizontal, label: 'Filters' },
              { id: 'text' as Tool, icon: Type, label: 'Text' },
              { id: 'audio' as Tool, icon: Music, label: 'Audio' },
            ].map((t) => (
              <button
                key={t.id}
                onClick={() => setActiveTool(activeTool === t.id ? null : t.id)}
                className={`flex flex-col items-center gap-1.5 py-3 rounded-xl border text-[10px] font-bold uppercase tracking-wide transition-all ${
                  activeTool === t.id
                    ? 'bg-rose-500 border-rose-500 text-white'
                    : 'bg-white/5 border-white/10 text-white/60 hover:bg-white/10 hover:text-white'
                }`}
              >
                <t.icon size={18} />
                {t.label}
              </button>
            ))}
          </div>

          {activeTool === 'trim' && activeClip && (
            <div className="space-y-5 animate-fade-in">
              <p className="text-[10px] font-bold text-white/40 uppercase tracking-widest">Editing Clip #{activeClipIndex + 1}</p>
              <div>
                <div className="flex justify-between text-[10px] font-bold text-white/40 uppercase tracking-widest mb-1.5">
                  <span>Start</span>
                  <span>{fmt(activeClip.trimStart)}</span>
                </div>
                <input
                  type="range"
                  min={0}
                  max={sourceDuration}
                  step={0.1}
                  value={activeClip.trimStart}
                  onChange={(e) => handleClipStartChange(parseFloat(e.target.value))}
                  className="w-full accent-rose-500"
                />
              </div>
              <div>
                <div className="flex justify-between text-[10px] font-bold text-white/40 uppercase tracking-widest mb-1.5">
                  <span>End</span>
                  <span>{fmt(activeClip.trimEnd)}</span>
                </div>
                <input
                  type="range"
                  min={0}
                  max={sourceDuration}
                  step={0.1}
                  value={activeClip.trimEnd}
                  onChange={(e) => handleClipEndChange(parseFloat(e.target.value))}
                  className="w-full accent-rose-500"
                />
              </div>
              <p className="text-xs text-white/50">
                Clip length: <span className="text-white font-semibold">{fmt(activeClip.trimEnd - activeClip.trimStart)}</span>
              </p>

              <div className="pt-5 border-t border-white/10">
                <div className="flex items-center gap-1.5 text-[10px] font-bold text-white/40 uppercase tracking-widest mb-2">
                  <Gauge size={12} /> Speed
                </div>
                <div className="flex flex-wrap gap-1.5">
                  {SPEED_OPTIONS.map((s) => (
                    <button
                      key={s}
                      onClick={() => updateActiveClip({ speed: s })}
                      className={`px-2.5 py-1.5 rounded-lg text-[11px] font-bold transition-all ${
                        activeClip.speed === s
                          ? 'bg-rose-500 text-white'
                          : 'bg-white/5 text-white/60 hover:bg-white/10 hover:text-white'
                      }`}
                    >
                      {s}x
                    </button>
                  ))}
                </div>
              </div>

              <Button onClick={splitActiveClip} variant="outline" size="sm" className="w-full border-white/20 text-white/80 hover:text-white hover:bg-white/10">
                <Scissors size={14} className="mr-1.5" /> Split at Playhead
              </Button>
            </div>
          )}

          {activeTool === 'filters' && (
            <div className="space-y-5 animate-fade-in">
              <p className="text-[10px] text-white/40">Filters apply across the whole timeline.</p>
              {[
                { key: 'brightness', label: 'Brightness', value: brightness, set: setBrightness },
                { key: 'contrast', label: 'Contrast', value: contrast, set: setContrast },
                { key: 'saturation', label: 'Saturation', value: saturation, set: setSaturation },
              ].map((s) => (
                <div key={s.key}>
                  <div className="flex justify-between text-[10px] font-bold text-white/40 uppercase tracking-widest mb-1.5">
                    <span>{s.label}</span>
                    <span>{Math.round(s.value * 100)}</span>
                  </div>
                  <input
                    type="range"
                    min={-0.6}
                    max={0.6}
                    step={0.01}
                    value={s.value}
                    onChange={(e) => s.set(parseFloat(e.target.value))}
                    className="w-full accent-rose-500"
                  />
                </div>
              ))}
            </div>
          )}

          {activeTool === 'text' && (
            <div className="space-y-4 animate-fade-in">
              <Button onClick={addOverlay} variant="primary" size="sm" className="w-full bg-rose-500 hover:bg-rose-600">
                <Type size={14} className="mr-1.5" /> Add Text Overlay
              </Button>

              {overlays.map((o) => (
                <div
                  key={o.id}
                  className={`p-3 rounded-xl border space-y-2 cursor-pointer ${
                    selectedOverlayId === o.id ? 'border-rose-400 bg-rose-500/10' : 'border-white/10 bg-white/5'
                  }`}
                  onClick={() => setSelectedOverlayId(o.id)}
                >
                  <div className="flex items-center gap-2">
                    <input
                      value={o.text}
                      onChange={(e) => updateOverlay(o.id, { text: e.target.value })}
                      className="flex-1 bg-white/10 rounded-lg px-2 py-1 text-xs text-white outline-none"
                    />
                    <input
                      type="color"
                      value={o.color}
                      onChange={(e) => updateOverlay(o.id, { color: e.target.value })}
                      className="w-7 h-7 rounded border border-white/20 bg-transparent cursor-pointer"
                    />
                    <button onClick={(e) => { e.stopPropagation(); removeOverlay(o.id); }} className="p-1.5 rounded-lg bg-red-500/10 hover:bg-red-500/20 text-red-300">
                      <Trash2 size={14} />
                    </button>
                  </div>
                  <div className="flex items-center gap-2 text-[10px] text-white/50">
                    <span>Appears</span>
                    <input
                      type="number"
                      value={o.startSec.toFixed(1)}
                      min={0}
                      max={o.endSec}
                      step={0.1}
                      onChange={(e) => updateOverlay(o.id, { startSec: parseFloat(e.target.value) })}
                      className="w-14 bg-white/10 rounded px-1 py-0.5 text-white outline-none"
                    />
                    <span>to</span>
                    <input
                      type="number"
                      value={o.endSec.toFixed(1)}
                      min={o.startSec}
                      max={totalOutputDuration}
                      step={0.1}
                      onChange={(e) => updateOverlay(o.id, { endSec: parseFloat(e.target.value) })}
                      className="w-14 bg-white/10 rounded px-1 py-0.5 text-white outline-none"
                    />
                    <span>sec</span>
                  </div>
                </div>
              ))}
              {overlays.length === 0 && (
                <p className="text-xs text-white/40">Drag text on the preview to position it once added.</p>
              )}
            </div>
          )}

          {activeTool === 'audio' && (
            <div className="space-y-5 animate-fade-in">
              <p className="text-[10px] text-white/40">Add a background music track, mixed against the original audio.</p>

              <input
                ref={musicInputRef}
                type="file"
                accept="audio/*"
                className="hidden"
                onChange={(e) => handleMusicFile(e.target.files?.[0] || null)}
              />

              {!musicUrl ? (
                <Button
                  onClick={() => musicInputRef.current?.click()}
                  variant="outline"
                  size="sm"
                  className="w-full border-white/20 text-white/80 hover:text-white hover:bg-white/10"
                >
                  <Upload size={14} className="mr-1.5" /> Upload Music Track
                </Button>
              ) : (
                <div className="p-3 rounded-xl border border-white/10 bg-white/5 space-y-3">
                  <div className="flex items-center gap-2">
                    <Music size={14} className="text-rose-300 shrink-0" />
                    <span className="flex-1 text-xs text-white/80 truncate">{musicName}</span>
                    <button onClick={() => handleMusicFile(null)} className="p-1.5 rounded-lg bg-red-500/10 hover:bg-red-500/20 text-red-300">
                      <Trash2 size={14} />
                    </button>
                  </div>
                  <div>
                    <div className="flex justify-between text-[10px] font-bold text-white/40 uppercase tracking-widest mb-1.5">
                      <span>Music Volume</span>
                      <span>{Math.round(musicVolume * 100)}%</span>
                    </div>
                    <input
                      type="range"
                      min={0}
                      max={1}
                      step={0.05}
                      value={musicVolume}
                      onChange={(e) => setMusicVolume(parseFloat(e.target.value))}
                      className="w-full accent-rose-500"
                    />
                  </div>
                  <div>
                    <div className="flex justify-between text-[10px] font-bold text-white/40 uppercase tracking-widest mb-1.5">
                      <span>Original Audio</span>
                      <span>{Math.round(originalVolume * 100)}%</span>
                    </div>
                    <input
                      type="range"
                      min={0}
                      max={1}
                      step={0.05}
                      value={originalVolume}
                      onChange={(e) => setOriginalVolume(parseFloat(e.target.value))}
                      className="w-full accent-rose-500"
                    />
                  </div>
                  <p className="text-[10px] text-white/40">Music loops to match the timeline length automatically.</p>
                </div>
              )}
            </div>
          )}

          <div className="mt-8 pt-6 border-t border-white/10">
            {exportError && (
              <p className="text-xs text-red-300 mb-3">{exportError}</p>
            )}
            {isExporting && (
              <div className="mb-3">
                <div className="h-1.5 bg-white/10 rounded-full overflow-hidden">
                  <div className="h-full bg-rose-500 transition-all" style={{ width: `${exportProgress * 100}%` }} />
                </div>
                <p className="text-[10px] text-white/40 mt-1.5">Rendering… this plays back every clip in real time, please keep this tab open.</p>
              </div>
            )}
            <Button onClick={handleExport} isLoading={isExporting} disabled={!supported || clips.length === 0} variant="primary" className="w-full bg-slate-900 hover:bg-black shadow-lg">
              <Download size={16} className="mr-2" /> Save Edited Video
            </Button>
          </div>
        </div>
      </div>
    </div>,
    document.body
  );
};
