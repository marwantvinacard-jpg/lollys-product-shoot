import React, { useEffect, useRef, useState } from 'react';
import { v4 as uuidv4 } from 'uuid';
import {
  Film, ImagePlus, X, Download, Clapperboard, AlertCircle, Clock, Wand2
} from 'lucide-react';
import { Button } from './Button';
import { MovieProject } from '../types';
import { fileToGenerativePart } from '../services/geminiService';
import { generateMovie, isMovieEngineReady, MovieEngine } from '../services/movieFlowService';
import { KlingVariant } from '../services/klingService';
import { openInCapCut } from '../utils/capcut';

const STORAGE_KEY = 'lollys_movie_projects';
const MAX_REFERENCE_IMAGES = 5;

export const MovieFlowStudio: React.FC<{ username?: string }> = ({ username }) => {
  const [prompt, setPrompt] = useState('');
  const [refFiles, setRefFiles] = useState<File[]>([]);
  const [engine, setEngine] = useState<MovieEngine>('seedance');
  const [klingVariant, setKlingVariant] = useState<KlingVariant>('v2.1-standard');
  const [duration, setDuration] = useState(24);
  const [aspectRatio, setAspectRatio] = useState<'16:9' | '9:16' | '1:1'>('16:9');
  const [resolution, setResolution] = useState<'720p' | '1080p'>('1080p');
  const [isGenerating, setIsGenerating] = useState(false);
  const [progressLabel, setProgressLabel] = useState('');
  const [progressFraction, setProgressFraction] = useState(0);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [projects, setProjects] = useState<MovieProject[]>(() => {
    try {
      const saved = localStorage.getItem(STORAGE_KEY);
      return saved ? JSON.parse(saved) : [];
    } catch {
      return [];
    }
  });

  useEffect(() => {
    try {
      // Object URLs (finalUrl/segments) can't survive a reload; only persist
      // completed metadata + reference thumbnails, not blob: URLs.
      const serializable = projects.map((p) => ({
        ...p,
        finalUrl: p.finalUrl?.startsWith('blob:') ? undefined : p.finalUrl,
        segments: undefined,
      }));
      localStorage.setItem(STORAGE_KEY, JSON.stringify(serializable));
    } catch (e) {
      console.warn('Failed to persist movie projects', e);
    }
  }, [projects]);

  const engineReady = isMovieEngineReady(engine);

  const handleAddFiles = (files: FileList | null) => {
    if (!files) return;
    const arr = Array.from(files);
    setRefFiles((prev) => [...prev, ...arr].slice(0, MAX_REFERENCE_IMAGES));
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  const removeFile = (idx: number) => {
    setRefFiles((prev) => prev.filter((_, i) => i !== idx));
  };

  const handleGenerate = async () => {
    if (!prompt.trim()) return;
    if (!engineReady) return;

    const previews = refFiles.map((f) => URL.createObjectURL(f));
    const project: MovieProject = {
      id: uuidv4(),
      prompt,
      referenceImagePreviews: previews,
      engine,
      aspectRatio,
      resolution,
      targetDurationSeconds: duration,
      status: 'generating',
      createdAt: Date.now(),
    };
    setProjects((prev) => [project, ...prev]);
    setIsGenerating(true);
    setProgressFraction(0);

    try {
      const referenceB64 = await Promise.all(refFiles.map((f) => fileToGenerativePart(f)));

      const result = await generateMovie({
        prompt,
        referenceImages: referenceB64,
        targetDurationSeconds: duration,
        engine,
        aspectRatio,
        resolution,
        klingVariant,
        username,
        onProgress: (info) => {
          if (info.stage === 'segment') {
            setProgressLabel(`Generating scene ${((info.segmentIndex ?? 0) + 1)} of ${info.totalSegments}…`);
            setProgressFraction(((info.segmentIndex ?? 0) + 0.5) / (info.totalSegments || 1));
            setProjects((prev) => prev.map((p) => p.id === project.id ? { ...p, status: 'generating', progressLabel: `Scene ${((info.segmentIndex ?? 0) + 1)}/${info.totalSegments}` } : p));
          } else if (info.stage === 'stitching') {
            setProgressLabel('Stitching scenes into one movie…');
            setProgressFraction(0.9 + (info.fraction || 0) * 0.1);
            setProjects((prev) => prev.map((p) => p.id === project.id ? { ...p, status: 'stitching', progressLabel: 'Stitching scenes…' } : p));
          }
        },
      });

      setProjects((prev) => prev.map((p) => p.id === project.id ? {
        ...p,
        status: 'completed',
        finalUrl: result.finalUrl,
        segments: result.segments,
      } : p));

      setPrompt('');
      setRefFiles([]);
    } catch (err: any) {
      console.error('Movie Flow generation failed', err);
      setProjects((prev) => prev.map((p) => p.id === project.id ? {
        ...p,
        status: 'failed',
        error: err?.message || 'Generation failed. Please try again.',
      } : p));
    } finally {
      setIsGenerating(false);
      setProgressLabel('');
      setProgressFraction(0);
    }
  };

  const downloadVideo = (url: string, filename: string) => {
    const link = document.createElement('a');
    link.href = url;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  const [capCutToast, setCapCutToast] = useState<string | null>(null);
  const sendToCapCut = (url: string, baseName: string) => {
    openInCapCut(url, baseName, 'mp4');
    setCapCutToast('Downloading your movie and opening CapCut — drop it onto the CapCut timeline to keep editing.');
    window.setTimeout(() => setCapCutToast(null), 7000);
  };

  return (
    <div className="space-y-12">
      <div className="text-center mb-4 relative">
        <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[500px] h-[260px] bg-gradient-to-r from-purple-200/30 to-rose-200/30 blur-[80px] -z-10 rounded-full" />
        <h1 className="text-4xl md:text-6xl font-display font-bold text-slate-900 mb-4 leading-tight tracking-tight">
          Movie <span className="text-transparent bg-clip-text bg-gradient-to-r from-purple-500 via-rose-500 to-blue-500">Flow</span>
        </h1>
        <p className="text-lg text-slate-600 max-w-2xl mx-auto font-light">
          One prompt, up to 5 reference images, and a long-form video stitched together — up to 60 seconds.
        </p>
      </div>

      {/* Studio Panel */}
      <div className="max-w-3xl mx-auto bg-white/50 backdrop-blur-sm rounded-2xl p-6 border border-white/60 shadow-sm space-y-6">
        {/* Engine selector */}
        <div className="space-y-2">
          <label className="text-xs font-bold text-slate-500 uppercase tracking-wider">Video Engine</label>
          <div className="flex bg-slate-100/50 p-1.5 rounded-2xl w-fit">
            {([
              { id: 'seedance' as MovieEngine, label: 'Seedance', hint: 'up to 5 reference images' },
              { id: 'veo' as MovieEngine, label: 'Veo', hint: '1 reference image' },
              { id: 'kling' as MovieEngine, label: 'Kling', hint: '1 reference image' },
            ]).map((e) => (
              <button
                key={e.id}
                onClick={() => setEngine(e.id)}
                className={`px-4 py-2.5 rounded-xl text-xs font-bold transition-all flex flex-col items-start ${
                  engine === e.id ? 'bg-white shadow-sm text-slate-900' : 'text-slate-500 hover:text-slate-700'
                }`}
              >
                {e.label}
                <span className="text-[9px] font-normal text-slate-400">{e.hint}</span>
              </button>
            ))}
          </div>
          {engine === 'kling' && (
            <div className="flex bg-white rounded-lg p-1 border border-slate-200 w-fit">
              {([
                { id: 'v2.1-standard' as const, label: 'Standard' },
                { id: 'v2.1-pro' as const, label: 'Pro' },
                { id: 'v1.6-pro' as const, label: '1.6 Pro' },
              ]).map((v) => (
                <button
                  key={v.id}
                  onClick={() => setKlingVariant(v.id)}
                  className={`px-3 py-1.5 rounded-md text-xs font-medium transition-all ${
                    klingVariant === v.id ? 'bg-rose-500 text-white shadow-sm' : 'text-slate-500 hover:bg-slate-50'
                  }`}
                >
                  {v.label}
                </button>
              ))}
            </div>
          )}
        </div>

        {/* Prompt */}
        <div className="space-y-2">
          <label className="text-xs font-bold text-slate-500 uppercase tracking-wider">Movie Prompt</label>
          <textarea
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            placeholder="e.g. A model walks through a sunlit marble atrium showing off the handbag, camera slowly circling, cinematic lighting..."
            rows={3}
            className="w-full px-4 py-3 rounded-lg bg-white border border-slate-200 text-sm focus:outline-none focus:ring-2 focus:ring-rose-500/20 focus:border-rose-500 transition-all placeholder:text-slate-400 resize-none"
          />
        </div>

        {/* Reference images */}
        <div className="space-y-2">
          <label className="text-xs font-bold text-slate-500 uppercase tracking-wider">
            Reference Images <span className="text-slate-400 font-normal normal-case">({refFiles.length}/{MAX_REFERENCE_IMAGES})</span>
          </label>
          <div className="grid grid-cols-5 gap-3">
            {refFiles.map((file, idx) => (
              <div key={idx} className="relative aspect-square rounded-xl overflow-hidden border border-slate-200 group">
                <img src={URL.createObjectURL(file)} alt={`Ref ${idx}`} className="w-full h-full object-cover" />
                <button
                  onClick={() => removeFile(idx)}
                  className="absolute top-1 right-1 bg-white/80 p-1 rounded-full text-slate-500 hover:text-red-500 opacity-0 group-hover:opacity-100 transition-opacity"
                >
                  <X size={12} />
                </button>
              </div>
            ))}
            {refFiles.length < MAX_REFERENCE_IMAGES && (
              <div
                onClick={() => fileInputRef.current?.click()}
                className="aspect-square rounded-xl border-2 border-dashed border-slate-200 hover:border-purple-300 hover:bg-slate-50 flex flex-col items-center justify-center cursor-pointer transition-all text-slate-400 hover:text-purple-500"
              >
                <ImagePlus size={20} />
              </div>
            )}
          </div>
          <input ref={fileInputRef} type="file" accept="image/*" multiple className="hidden" onChange={(e) => handleAddFiles(e.target.files)} />
        </div>

        {/* Duration / aspect / resolution */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          <div className="space-y-2">
            <label className="text-xs font-bold text-slate-500 uppercase tracking-wider flex items-center gap-1.5">
              <Clock size={12} /> Duration <span className="text-slate-800">{duration}s</span>
            </label>
            <input
              type="range"
              min={8}
              max={60}
              step={2}
              value={duration}
              onChange={(e) => setDuration(parseInt(e.target.value))}
              className="w-full accent-rose-500"
            />
          </div>
          <div className="space-y-2">
            <label className="text-xs font-bold text-slate-500 uppercase tracking-wider">Aspect Ratio</label>
            <div className="flex bg-white rounded-lg p-1 border border-slate-200 w-fit">
              {(['16:9', '9:16', '1:1'] as const).map((r) => (
                <button
                  key={r}
                  onClick={() => setAspectRatio(r)}
                  className={`px-3 py-1.5 rounded-md text-xs font-medium transition-all ${
                    aspectRatio === r ? 'bg-rose-500 text-white shadow-sm' : 'text-slate-500 hover:bg-slate-50'
                  }`}
                >
                  {r}
                </button>
              ))}
            </div>
          </div>
          <div className="space-y-2">
            <label className="text-xs font-bold text-slate-500 uppercase tracking-wider">Resolution</label>
            <div className="flex bg-white rounded-lg p-1 border border-slate-200 w-fit">
              {(['720p', '1080p'] as const).map((r) => (
                <button
                  key={r}
                  onClick={() => setResolution(r)}
                  className={`px-3 py-1.5 rounded-md text-xs font-medium transition-all ${
                    resolution === r ? 'bg-rose-500 text-white shadow-sm' : 'text-slate-500 hover:bg-slate-50'
                  }`}
                >
                  {r}
                </button>
              ))}
            </div>
          </div>
        </div>

        <p className="text-[11px] text-slate-400 leading-relaxed">
          Long movies are generated as ~{engine === 'veo' ? 8 : engine === 'kling' ? 5 : 10}s scenes and stitched into one continuous video (final export is video-only for
          cross-browser reliability — each scene's own audio stays available individually below).
        </p>

        <Button
          onClick={handleGenerate}
          disabled={isGenerating || !prompt.trim() || !engineReady}
          isLoading={isGenerating}
          variant="primary"
          className="w-full py-4 bg-slate-900 hover:bg-slate-800 shadow-xl shadow-slate-200/50"
        >
          <Wand2 size={18} className="mr-2 text-rose-400" />
          {isGenerating ? (progressLabel || 'Directing your movie…') : 'Generate Movie'}
        </Button>

        {isGenerating && (
          <div className="h-1.5 bg-slate-100 rounded-full overflow-hidden">
            <div className="h-full bg-gradient-to-r from-rose-500 to-purple-500 transition-all" style={{ width: `${progressFraction * 100}%` }} />
          </div>
        )}
      </div>

      {/* Projects list */}
      {projects.length > 0 && (
        <div className="space-y-8">
          <div className="flex items-center gap-4">
            <h3 className="text-2xl font-display font-bold text-slate-800">Your Movies</h3>
            <div className="h-px flex-1 bg-gradient-to-r from-slate-200 to-transparent" />
          </div>

          {projects.map((project) => (
            <div key={project.id} className="glass-panel rounded-[1.5rem] p-6">
              <div className="flex flex-col lg:flex-row gap-6">
                <div className="lg:w-2/3">
                  <div className="rounded-xl overflow-hidden bg-slate-900 aspect-video flex items-center justify-center">
                    {project.finalUrl ? (
                      <video src={project.finalUrl} controls className="w-full h-full object-contain" />
                    ) : project.status === 'failed' ? (
                      <div className="text-red-400 flex flex-col items-center p-6 text-center">
                        <AlertCircle size={24} className="mb-2" />
                        <span className="text-xs">{project.error || 'Generation failed'}</span>
                      </div>
                    ) : (
                      <div className="text-white/60 flex flex-col items-center gap-2 p-6 text-center">
                        <Clapperboard size={28} className="animate-pulse" />
                        <span className="text-xs">{project.progressLabel || 'Rendering…'}</span>
                      </div>
                    )}
                  </div>
                </div>
                <div className="lg:w-1/3 flex flex-col gap-3">
                  <div className="flex items-center gap-2 text-xs font-bold text-slate-500 uppercase tracking-wider">
                    <Film size={14} className="text-rose-400" /> {project.engine} · {project.targetDurationSeconds}s
                  </div>
                  <p className="text-sm text-slate-700 line-clamp-4">{project.prompt}</p>
                  {project.finalUrl && (
                    <div className="mt-auto space-y-2">
                      <Button onClick={() => downloadVideo(project.finalUrl!, `Lollys-MovieFlow-${project.id}.webm`)} variant="outline" size="sm" className="w-full border-slate-200">
                        <Download size={14} className="mr-2" /> Download Movie
                      </Button>
                      <Button
                        onClick={() => sendToCapCut(project.finalUrl!, `Lollys-MovieFlow-${project.id}`)}
                        variant="outline"
                        size="sm"
                        className="w-full border-slate-200 hover:border-cyan-200 hover:bg-cyan-50 hover:text-cyan-600"
                        title="Download and open in the CapCut web editor"
                      >
                        <Film size={14} className="mr-2" /> Edit in CapCut
                      </Button>
                    </div>
                  )}
                  {project.segments && project.segments.length > 0 && (
                    <details className="text-xs text-slate-500">
                      <summary className="cursor-pointer font-medium text-slate-600">Individual scenes (with audio)</summary>
                      <div className="mt-2 space-y-2">
                        {project.segments.map((s, idx) => (
                          <div key={idx} className="flex items-center justify-between gap-2">
                            <span>Scene {idx + 1} ({Math.round(s.durationSeconds)}s)</span>
                            <span className="flex items-center gap-2">
                              <button onClick={() => downloadVideo(s.url, `Lollys-MovieFlow-${project.id}-scene${idx + 1}.mp4`)} className="text-rose-500 hover:underline">
                                Download
                              </button>
                              <button onClick={() => sendToCapCut(s.url, `Lollys-MovieFlow-${project.id}-scene${idx + 1}`)} className="text-cyan-600 hover:underline">
                                CapCut
                              </button>
                            </span>
                          </div>
                        ))}
                      </div>
                    </details>
                  )}
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {capCutToast && (
        <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-[200] max-w-sm px-4 py-3 rounded-xl bg-slate-900 text-white text-xs shadow-2xl shadow-black/30 flex items-start gap-2.5 animate-fade-in-up">
          <Film size={15} className="mt-0.5 shrink-0 text-cyan-300" />
          <span>{capCutToast}</span>
        </div>
      )}
    </div>
  );
};
