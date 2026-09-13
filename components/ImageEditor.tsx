import React, { useEffect, useRef, useState, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { Canvas, Image as FabricImage, IText, Rect, filters as fabricFilters, PencilBrush } from 'fabric';
import {
  X, RotateCw, RotateCcw, FlipHorizontal, FlipVertical, Type, Trash2,
  Undo2, Redo2, Download, Crop as CropIcon, SlidersHorizontal, Sparkles, Check, Smile,
  Eraser, Wand2, AlertCircle
} from 'lucide-react';
import { Button } from './Button';
import { removeObjectFromImage, removeBackgroundFromImage } from '../services/geminiService';

interface ImageEditorProps {
  isOpen: boolean;
  imageUrl: string;
  title: string;
  onClose: () => void;
  onSave: (dataUrl: string) => void;
}

type Tool = 'filters' | 'crop' | 'text' | 'stickers' | 'remove' | null;

const MASK_COLOR = 'rgba(255,0,255,0.65)';

const PRESETS: { id: string; label: string; brightness: number; contrast: number; saturation: number }[] = [
  { id: 'none', label: 'Original', brightness: 0, contrast: 0, saturation: 0 },
  { id: 'vivid', label: 'Vivid', brightness: 0.03, contrast: 0.12, saturation: 0.3 },
  { id: 'soft', label: 'Soft Studio', brightness: 0.08, contrast: -0.05, saturation: -0.05 },
  { id: 'bw', label: 'B & W', brightness: 0, contrast: 0.1, saturation: -1 },
  { id: 'warm', label: 'Warm', brightness: 0.04, contrast: 0.05, saturation: 0.12 },
  { id: 'cool', label: 'Cool', brightness: 0, contrast: 0.05, saturation: -0.08 },
];

const STICKERS = ['✨', '🔥', '💯', '⭐️', '💖', '🏷️', '🛍️', '👍', '🎉', 'NEW', 'SALE'];

const MAX_PREVIEW = 900;

export const ImageEditor: React.FC<ImageEditorProps> = ({ isOpen, imageUrl, title, onClose, onSave }) => {
  const canvasElRef = useRef<HTMLCanvasElement>(null);
  const fcRef = useRef<Canvas | null>(null);
  const imgRef = useRef<any>(null);
  const naturalSizeRef = useRef({ width: 0, height: 0 });
  const isRestoringRef = useRef(false);
  const historyRef = useRef<{ stack: string[]; index: number }>({ stack: [], index: -1 });

  const [ready, setReady] = useState(false);
  const [activeTool, setActiveTool] = useState<Tool>(null);
  const [preset, setPreset] = useState('none');
  const [brightness, setBrightness] = useState(0);
  const [contrast, setContrast] = useState(0);
  const [saturation, setSaturation] = useState(0);
  const [hasSelection, setHasSelection] = useState<'text' | 'other' | null>(null);
  const [textColor, setTextColor] = useState('#ffffff');
  const [textSize, setTextSize] = useState(48);
  const [canUndo, setCanUndo] = useState(false);
  const [canRedo, setCanRedo] = useState(false);
  const [isExporting, setIsExporting] = useState(false);
  const cropRectRef = useRef<Rect | null>(null);
  const [cropActive, setCropActive] = useState(false);

  // Object / background removal (AI eraser)
  const activeToolRef = useRef<Tool>(null);
  const maskPathsRef = useRef<any[]>([]);
  const [brushSize, setBrushSize] = useState(40);
  const [maskCount, setMaskCount] = useState(0);
  const [isErasing, setIsErasing] = useState(false);
  const [isRemovingBg, setIsRemovingBg] = useState(false);
  const [eraseError, setEraseError] = useState<string | null>(null);

  useEffect(() => {
    activeToolRef.current = activeTool;
  }, [activeTool]);

  const pushHistory = useCallback(() => {
    if (!fcRef.current || isRestoringRef.current) return;
    const json = JSON.stringify(fcRef.current.toJSON());
    const h = historyRef.current;
    const next = h.stack.slice(0, h.index + 1);
    next.push(json);
    historyRef.current = { stack: next, index: next.length - 1 };
    setCanUndo(historyRef.current.index > 0);
    setCanRedo(false);
  }, []);

  // Initialize canvas + load image
  useEffect(() => {
    if (!isOpen || !canvasElRef.current) return;

    let disposed = false;
    const canvas = new Canvas(canvasElRef.current, { backgroundColor: '#111827', preserveObjectStacking: true });
    fcRef.current = canvas;

    (async () => {
      const img: any = await FabricImage.fromURL(imageUrl, { crossOrigin: 'anonymous' });
      if (disposed) return;

      const naturalW = img.width;
      const naturalH = img.height;
      naturalSizeRef.current = { width: naturalW, height: naturalH };

      const scale = Math.min(MAX_PREVIEW / naturalW, MAX_PREVIEW / naturalH, 1);
      canvas.setDimensions({ width: Math.round(naturalW * scale), height: Math.round(naturalH * scale) });

      img.set({
        left: 0,
        top: 0,
        scaleX: scale,
        scaleY: scale,
        selectable: false,
        evented: false,
        hasControls: false,
      });

      canvas.add(img);
      canvas.renderAll();
      imgRef.current = img;
      setReady(true);
      historyRef.current = { stack: [JSON.stringify(canvas.toJSON())], index: 0 };
      setCanUndo(false);
      setCanRedo(false);
    })();

    const onModified = () => pushHistory();
    canvas.on('object:added', onModified);
    canvas.on('object:modified', onModified);
    canvas.on('object:removed', onModified);

    const onPathCreated = (e: any) => {
      if (activeToolRef.current !== 'remove' || !e.path) return;
      e.path.set({ selectable: false, evented: false });
      maskPathsRef.current.push(e.path);
      setMaskCount(maskPathsRef.current.length);
    };
    canvas.on('path:created', onPathCreated);

    const onSelection = () => {
      const obj = canvas.getActiveObject();
      if (!obj) {
        setHasSelection(null);
        return;
      }
      if ((obj as any).isType?.('i-text') || obj.type === 'i-text') {
        setHasSelection('text');
        setTextColor((obj as any).fill || '#ffffff');
        setTextSize((obj as any).fontSize || 48);
      } else {
        setHasSelection('other');
      }
    };
    canvas.on('selection:created', onSelection);
    canvas.on('selection:updated', onSelection);
    canvas.on('selection:cleared', () => setHasSelection(null));

    return () => {
      disposed = true;
      canvas.dispose();
      fcRef.current = null;
      imgRef.current = null;
      setReady(false);
      setActiveTool(null);
      setCropActive(false);
      cropRectRef.current = null;
      maskPathsRef.current = [];
      setMaskCount(0);
      setEraseError(null);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen, imageUrl]);

  const applyFilterState = useCallback((b: number, c: number, s: number) => {
    const img = imgRef.current;
    const canvas = fcRef.current;
    if (!img || !canvas) return;
    const stack: any[] = [];
    if (b !== 0) stack.push(new (fabricFilters as any).Brightness({ brightness: b }));
    if (c !== 0) stack.push(new (fabricFilters as any).Contrast({ contrast: c }));
    if (s !== 0) stack.push(new (fabricFilters as any).Saturation({ saturation: s }));
    img.filters = stack;
    img.applyFilters();
    canvas.renderAll();
  }, []);

  const handlePreset = (p: typeof PRESETS[number]) => {
    setPreset(p.id);
    setBrightness(p.brightness);
    setContrast(p.contrast);
    setSaturation(p.saturation);
    applyFilterState(p.brightness, p.contrast, p.saturation);
    pushHistory();
  };

  const handleSlider = (key: 'brightness' | 'contrast' | 'saturation', value: number) => {
    setPreset('custom');
    let b = brightness, c = contrast, s = saturation;
    if (key === 'brightness') { b = value; setBrightness(value); }
    if (key === 'contrast') { c = value; setContrast(value); }
    if (key === 'saturation') { s = value; setSaturation(value); }
    applyFilterState(b, c, s);
  };

  const handleRotate = (deg: number) => {
    const img = imgRef.current;
    const canvas = fcRef.current;
    if (!img || !canvas) return;
    img.set({ angle: ((img.angle || 0) + deg + 360) % 360 });
    canvas.renderAll();
    pushHistory();
  };

  const handleFlip = (axis: 'flipX' | 'flipY') => {
    const img = imgRef.current;
    const canvas = fcRef.current;
    if (!img || !canvas) return;
    img.set(axis, !img[axis]);
    canvas.renderAll();
    pushHistory();
  };

  const addText = () => {
    const canvas = fcRef.current;
    if (!canvas) return;
    const text = new IText('Double-click to edit', {
      left: canvas.getWidth() / 2 - 80,
      top: canvas.getHeight() / 2 - 20,
      fontSize: textSize,
      fill: textColor,
      fontFamily: "'Space Grotesk', sans-serif",
      fontWeight: 'bold',
      stroke: 'rgba(0,0,0,0.35)',
      strokeWidth: 1,
    });
    canvas.add(text);
    canvas.setActiveObject(text);
    canvas.renderAll();
    setActiveTool(null);
  };

  const addSticker = (glyph: string) => {
    const canvas = fcRef.current;
    if (!canvas) return;
    const isEmoji = glyph.length <= 4 && /\p{Emoji}/u.test(glyph);
    const text = new IText(glyph, {
      left: canvas.getWidth() / 2 - 30,
      top: canvas.getHeight() / 2 - 30,
      fontSize: isEmoji ? 64 : 32,
      fill: isEmoji ? '#000000' : '#ffffff',
      fontFamily: isEmoji ? 'sans-serif' : "'Space Grotesk', sans-serif",
      fontWeight: 'bold',
      backgroundColor: isEmoji ? undefined : '#f43f5e',
      padding: isEmoji ? 0 : 8,
    });
    canvas.add(text);
    canvas.setActiveObject(text);
    canvas.renderAll();
  };

  const updateSelectedText = (patch: any) => {
    const canvas = fcRef.current;
    const obj = canvas?.getActiveObject();
    if (!canvas || !obj) return;
    obj.set(patch);
    canvas.renderAll();
    pushHistory();
  };

  const deleteSelected = () => {
    const canvas = fcRef.current;
    const obj = canvas?.getActiveObject();
    if (!canvas || !obj || obj === imgRef.current) return;
    canvas.remove(obj);
    canvas.discardActiveObject();
    canvas.renderAll();
  };

  const startCrop = () => {
    const canvas = fcRef.current;
    if (!canvas) return;
    setActiveTool('crop');
    setCropActive(true);
    const w = canvas.getWidth() * 0.7;
    const h = canvas.getHeight() * 0.7;
    const rect = new Rect({
      left: (canvas.getWidth() - w) / 2,
      top: (canvas.getHeight() - h) / 2,
      width: w,
      height: h,
      fill: 'rgba(244,63,94,0.12)',
      stroke: '#f43f5e',
      strokeWidth: 2,
      strokeDashArray: [6, 4],
      cornerColor: '#f43f5e',
      cornerStyle: 'circle',
      transparentCorners: false,
      lockRotation: true,
    });
    (rect as any).setControlsVisibility?.({ mtr: false });
    canvas.add(rect);
    canvas.setActiveObject(rect);
    canvas.renderAll();
    cropRectRef.current = rect;
  };

  const cancelCrop = () => {
    const canvas = fcRef.current;
    if (cropRectRef.current && canvas) {
      canvas.remove(cropRectRef.current);
      canvas.renderAll();
    }
    cropRectRef.current = null;
    setCropActive(false);
    setActiveTool(null);
  };

  const applyCrop = () => {
    const canvas = fcRef.current;
    const img = imgRef.current;
    const rect = cropRectRef.current;
    if (!canvas || !img || !rect) return;

    const rectW = rect.width! * (rect.scaleX || 1);
    const rectH = rect.height! * (rect.scaleY || 1);
    const offsetX = rect.left!;
    const offsetY = rect.top!;

    const localLeft = (rect.left! - img.left!) / img.scaleX!;
    const localTop = (rect.top! - img.top!) / img.scaleY!;
    const localWidth = rectW / img.scaleX!;
    const localHeight = rectH / img.scaleY!;

    const prevCropX = img.cropX || 0;
    const prevCropY = img.cropY || 0;

    img.set({
      cropX: prevCropX + Math.max(0, localLeft),
      cropY: prevCropY + Math.max(0, localTop),
      width: Math.max(1, localWidth),
      height: Math.max(1, localHeight),
      left: 0,
      top: 0,
    });

    canvas.remove(rect);
    cropRectRef.current = null;

    // Shrink the canvas to the cropped bounds and shift every other object
    // (text/stickers added before cropping) to match -- otherwise the crop
    // only visually resizes the image while the canvas (and the exported
    // PNG) keeps its original dimensions, baking in a border of the canvas
    // background color around the "cropped" result.
    canvas.getObjects().forEach((o: any) => {
      if (o === img) return;
      o.set({ left: (o.left || 0) - offsetX, top: (o.top || 0) - offsetY });
      o.setCoords();
    });
    canvas.setDimensions({ width: Math.round(rectW), height: Math.round(rectH) });

    canvas.setActiveObject(img);
    canvas.renderAll();
    setCropActive(false);
    setActiveTool(null);
    pushHistory();
  };

  // --- AI Object / Background Removal ---

  useEffect(() => {
    const canvas = fcRef.current;
    if (canvas?.freeDrawingBrush) (canvas.freeDrawingBrush as any).width = brushSize;
  }, [brushSize]);

  const clearMask = useCallback(() => {
    const canvas = fcRef.current;
    if (!canvas) return;
    maskPathsRef.current.forEach((p) => canvas.remove(p));
    maskPathsRef.current = [];
    setMaskCount(0);
    canvas.renderAll();
  }, []);

  const startRemove = () => {
    const canvas = fcRef.current;
    if (!canvas) return;
    setActiveTool('remove');
    setEraseError(null);
    canvas.discardActiveObject();
    const brush = new PencilBrush(canvas);
    brush.color = MASK_COLOR;
    brush.width = brushSize;
    canvas.freeDrawingBrush = brush;
    canvas.isDrawingMode = true;
    canvas.renderAll();
  };

  const exitRemoveTool = useCallback(() => {
    const canvas = fcRef.current;
    if (canvas) canvas.isDrawingMode = false;
    clearMask();
    setEraseError(null);
  }, [clearMask]);

  // Exports the canvas at natural resolution. When hideExtras is true, every
  // object except the base image (and any in-progress mask strokes) is
  // temporarily hidden so the AI sees only the photo + highlight, not
  // user-added text/stickers baked into the composite.
  const exportCompositeBase64 = (hideExtras: boolean): { base64: string; mimeType: string } => {
    const canvas = fcRef.current!;
    const img = imgRef.current;
    const hidden: any[] = [];
    if (hideExtras) {
      canvas.getObjects().forEach((o: any) => {
        if (o !== img && !maskPathsRef.current.includes(o) && o.visible !== false) {
          hidden.push(o);
          o.set('visible', false);
        }
      });
    }
    canvas.discardActiveObject();
    canvas.renderAll();
    // See handleExport's comment: derive from the image's own scale, not
    // naturalWidth/canvas.getWidth(), so this stays correct after a crop.
    const scaleX = (img as any)?.scaleX || 1;
    const multiplier = scaleX ? 1 / scaleX : 1;
    const dataUrl = canvas.toDataURL({ format: 'png', multiplier, quality: 1 });
    hidden.forEach((o) => o.set('visible', true));
    canvas.renderAll();
    return { base64: dataUrl.split(',')[1], mimeType: 'image/png' };
  };

  // The AI returns a flattened image reflecting whatever was visible in the
  // exported composite (crop/rotate/flip already baked in), so the
  // replacement is dropped in at identity transform covering the same canvas
  // area — other objects (text/stickers) keep their existing positions.
  const replaceBaseImage = async (newUrl: string) => {
    const canvas = fcRef.current;
    const oldImg = imgRef.current;
    if (!canvas) return;
    const newImg: any = await FabricImage.fromURL(newUrl, { crossOrigin: 'anonymous' });
    const w = canvas.getWidth();
    const h = canvas.getHeight();
    newImg.set({
      left: 0,
      top: 0,
      scaleX: w / newImg.width,
      scaleY: h / newImg.height,
      angle: 0,
      flipX: false,
      flipY: false,
      selectable: false,
      evented: false,
      hasControls: false,
    });
    canvas.insertAt(0, newImg);
    if (oldImg) canvas.remove(oldImg);
    imgRef.current = newImg;
    canvas.renderAll();
    pushHistory();
  };

  const applyRemoval = async () => {
    const canvas = fcRef.current;
    if (!canvas || maskPathsRef.current.length === 0) return;
    setIsErasing(true);
    setEraseError(null);
    canvas.isDrawingMode = false;
    try {
      const { base64, mimeType } = exportCompositeBase64(true);
      const result = await removeObjectFromImage(base64, mimeType);
      await replaceBaseImage(result.url);
      clearMask();
    } catch (err: any) {
      setEraseError(err?.message || 'Object removal failed. Please try again.');
    } finally {
      setIsErasing(false);
      if (fcRef.current) fcRef.current.isDrawingMode = true;
    }
  };

  const applyBackgroundRemoval = async () => {
    const canvas = fcRef.current;
    if (!canvas) return;
    setIsRemovingBg(true);
    setEraseError(null);
    const wasDrawing = canvas.isDrawingMode;
    canvas.isDrawingMode = false;
    try {
      const { base64, mimeType } = exportCompositeBase64(true);
      const result = await removeBackgroundFromImage(base64, mimeType);
      await replaceBaseImage(result.url);
    } catch (err: any) {
      setEraseError(err?.message || 'Background removal failed. Please try again.');
    } finally {
      setIsRemovingBg(false);
      if (fcRef.current) fcRef.current.isDrawingMode = wasDrawing;
    }
  };

  const restoreFromHistory = (index: number) => {
    const canvas = fcRef.current;
    const h = historyRef.current;
    if (!canvas || index < 0 || index >= h.stack.length) return;
    isRestoringRef.current = true;
    canvas.loadFromJSON(h.stack[index]).then(() => {
      canvas.getObjects().forEach((o: any) => {
        if (o.type === 'image') imgRef.current = o;
      });
      canvas.renderAll();
      historyRef.current = { ...h, index };
      setCanUndo(index > 0);
      setCanRedo(index < h.stack.length - 1);
      isRestoringRef.current = false;
    });
  };

  const handleToolClick = (id: Tool) => {
    if (id === 'crop') {
      cropActive ? cancelCrop() : startCrop();
      return;
    }
    if (cropActive) cancelCrop();
    if (activeTool === 'remove') exitRemoveTool();
    if (id === 'remove') {
      if (activeTool === 'remove') setActiveTool(null);
      else startRemove();
      return;
    }
    setActiveTool(activeTool === id ? null : id);
  };

  const handleUndo = () => restoreFromHistory(historyRef.current.index - 1);
  const handleRedo = () => restoreFromHistory(historyRef.current.index + 1);

  const handleExport = () => {
    const canvas = fcRef.current;
    if (!canvas) return;
    setIsExporting(true);
    try {
      canvas.discardActiveObject();
      canvas.renderAll();
      // Derived from the image's own natural-to-screen scale rather than
      // naturalWidth/canvas.getWidth(): that ratio only held before any crop
      // (which resizes the canvas to less than the full natural width). The
      // image's scaleX/scaleY stay correct across crop, rotate, and the AI
      // object-removal/background-removal replacement paths.
      const scaleX = imgRef.current?.scaleX || 1;
      const multiplier = scaleX ? 1 / scaleX : 1;
      const dataUrl = canvas.toDataURL({ format: 'png', multiplier, quality: 1 });
      onSave(dataUrl);
      onClose();
    } finally {
      setIsExporting(false);
    }
  };

  if (!isOpen) return null;

  return createPortal(
    <div className="fixed inset-0 z-[100] flex flex-col bg-slate-900/97 backdrop-blur-xl animate-fade-in">
      {/* Header */}
      <div className="flex items-center justify-between px-6 py-4 border-b border-white/10 shrink-0">
        <div className="flex items-center gap-3">
          <div className="p-2 rounded-lg bg-rose-500/20 text-rose-300">
            <Sparkles size={18} />
          </div>
          <h3 className="text-white font-display text-lg tracking-wide">Edit — {title}</h3>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={handleUndo}
            disabled={!canUndo}
            className="p-2 rounded-lg text-white/70 hover:text-white hover:bg-white/10 disabled:opacity-30 disabled:hover:bg-transparent transition-all"
            title="Undo"
          >
            <Undo2 size={18} />
          </button>
          <button
            onClick={handleRedo}
            disabled={!canRedo}
            className="p-2 rounded-lg text-white/70 hover:text-white hover:bg-white/10 disabled:opacity-30 disabled:hover:bg-transparent transition-all"
            title="Redo"
          >
            <Redo2 size={18} />
          </button>
          <button onClick={onClose} className="p-2 ml-2 rounded-full bg-white/10 hover:bg-white/20 text-white transition-colors">
            <X size={20} />
          </button>
        </div>
      </div>

      {/* Body */}
      <div className="flex-1 flex flex-col md:flex-row overflow-hidden">
        {/* Canvas area */}
        <div className="flex-1 flex items-center justify-center p-6 overflow-auto relative">
          {!ready && (
            <div className="text-white/60 text-sm flex items-center gap-2">
              <Sparkles size={16} className="animate-spin" /> Loading image…
            </div>
          )}
          <div className="rounded-xl overflow-hidden shadow-2xl shadow-black/50">
            <canvas ref={canvasElRef} />
          </div>
        </div>

        {/* Toolbar */}
        <div className="w-full md:w-80 border-t md:border-t-0 md:border-l border-white/10 bg-black/20 p-5 overflow-y-auto shrink-0">
          {/* Tool tabs */}
          <div className="grid grid-cols-3 gap-2 mb-6">
            {[
              { id: 'filters' as Tool, icon: SlidersHorizontal, label: 'Filters' },
              { id: 'crop' as Tool, icon: CropIcon, label: 'Crop' },
              { id: 'text' as Tool, icon: Type, label: 'Text' },
              { id: 'stickers' as Tool, icon: Smile, label: 'Sticker' },
              { id: 'remove' as Tool, icon: Eraser, label: 'Remove' },
            ].map((t) => (
              <button
                key={t.id}
                onClick={() => handleToolClick(t.id)}
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

          {/* Rotate / Flip — always available */}
          <div className="flex items-center gap-2 mb-6 pb-6 border-b border-white/10">
            <button onClick={() => handleRotate(-90)} className="flex-1 flex items-center justify-center gap-1.5 py-2 rounded-lg bg-white/5 hover:bg-white/10 text-white/80 text-xs font-medium transition-all" title="Rotate left">
              <RotateCcw size={16} /> Left
            </button>
            <button onClick={() => handleRotate(90)} className="flex-1 flex items-center justify-center gap-1.5 py-2 rounded-lg bg-white/5 hover:bg-white/10 text-white/80 text-xs font-medium transition-all" title="Rotate right">
              <RotateCw size={16} /> Right
            </button>
            <button onClick={() => handleFlip('flipX')} className="p-2 rounded-lg bg-white/5 hover:bg-white/10 text-white/80 transition-all" title="Flip horizontal">
              <FlipHorizontal size={16} />
            </button>
            <button onClick={() => handleFlip('flipY')} className="p-2 rounded-lg bg-white/5 hover:bg-white/10 text-white/80 transition-all" title="Flip vertical">
              <FlipVertical size={16} />
            </button>
          </div>

          {activeTool === 'filters' && (
            <div className="space-y-5 animate-fade-in">
              <div>
                <p className="text-[10px] font-bold text-white/40 uppercase tracking-widest mb-2">Presets</p>
                <div className="flex flex-wrap gap-2">
                  {PRESETS.map((p) => (
                    <button
                      key={p.id}
                      onClick={() => handlePreset(p)}
                      className={`px-3 py-1.5 rounded-full text-[11px] font-medium border transition-all ${
                        preset === p.id ? 'bg-rose-500 border-rose-500 text-white' : 'bg-white/5 border-white/10 text-white/70 hover:bg-white/10'
                      }`}
                    >
                      {p.label}
                    </button>
                  ))}
                </div>
              </div>

              {[
                { key: 'brightness' as const, label: 'Brightness', value: brightness },
                { key: 'contrast' as const, label: 'Contrast', value: contrast },
                { key: 'saturation' as const, label: 'Saturation', value: saturation },
              ].map((s) => (
                <div key={s.key}>
                  <div className="flex justify-between text-[10px] font-bold text-white/40 uppercase tracking-widest mb-1.5">
                    <span>{s.label}</span>
                    <span>{Math.round(s.value * 100)}</span>
                  </div>
                  <input
                    type="range"
                    min={-1}
                    max={1}
                    step={0.01}
                    value={s.value}
                    onChange={(e) => handleSlider(s.key, parseFloat(e.target.value))}
                    onMouseUp={pushHistory}
                    onTouchEnd={pushHistory}
                    className="w-full accent-rose-500"
                  />
                </div>
              ))}
            </div>
          )}

          {activeTool === 'crop' && cropActive && (
            <div className="space-y-4 animate-fade-in">
              <p className="text-xs text-white/60 leading-relaxed">
                Drag the corners of the box on the image to select your crop area, then apply. Crop before rotating for best accuracy.
              </p>
              <div className="flex gap-2">
                <Button onClick={applyCrop} variant="primary" size="sm" className="flex-1 bg-rose-500 hover:bg-rose-600">
                  <Check size={14} className="mr-1.5" /> Apply Crop
                </Button>
                <Button onClick={cancelCrop} variant="outline" size="sm" className="flex-1 border-white/20 text-white/70 hover:text-white">
                  Cancel
                </Button>
              </div>
            </div>
          )}

          {activeTool === 'text' && (
            <div className="space-y-4 animate-fade-in">
              <Button onClick={addText} variant="primary" size="sm" className="w-full bg-rose-500 hover:bg-rose-600">
                <Type size={14} className="mr-1.5" /> Add Text Box
              </Button>
              <p className="text-xs text-white/50">Tip: double-click any text on the canvas to edit it, drag to move, use the corner handle to resize.</p>
            </div>
          )}

          {activeTool === 'stickers' && (
            <div className="grid grid-cols-4 gap-2 animate-fade-in">
              {STICKERS.map((s) => (
                <button
                  key={s}
                  onClick={() => addSticker(s)}
                  className="aspect-square rounded-xl bg-white/5 hover:bg-white/10 border border-white/10 flex items-center justify-center text-2xl transition-all"
                >
                  {s.length <= 2 ? s : <span className="text-[10px] font-bold text-white">{s}</span>}
                </button>
              ))}
            </div>
          )}

          {activeTool === 'remove' && (
            <div className="space-y-5 animate-fade-in">
              <p className="text-xs text-white/60 leading-relaxed">
                Paint over the object you want to erase, then apply. The AI reconstructs the background underneath.
              </p>

              <div>
                <div className="flex justify-between text-[10px] font-bold text-white/40 uppercase tracking-widest mb-1.5">
                  <span>Brush Size</span>
                  <span>{brushSize}px</span>
                </div>
                <input
                  type="range"
                  min={10}
                  max={100}
                  step={2}
                  value={brushSize}
                  onChange={(e) => setBrushSize(parseInt(e.target.value))}
                  className="w-full accent-fuchsia-500"
                />
              </div>

              <p className="text-[10px] text-white/40">{maskCount > 0 ? `${maskCount} stroke${maskCount === 1 ? '' : 's'} painted` : 'No area painted yet'}</p>

              <div className="flex gap-2">
                <Button
                  onClick={applyRemoval}
                  isLoading={isErasing}
                  disabled={maskCount === 0 || isErasing || isRemovingBg}
                  variant="primary"
                  size="sm"
                  className="flex-1 bg-fuchsia-600 hover:bg-fuchsia-700"
                >
                  <Wand2 size={14} className="mr-1.5" /> Erase Object
                </Button>
                <Button
                  onClick={clearMask}
                  disabled={maskCount === 0 || isErasing}
                  variant="outline"
                  size="sm"
                  className="border-white/20 text-white/70 hover:text-white"
                >
                  Clear
                </Button>
              </div>

              <div className="pt-5 border-t border-white/10 space-y-2">
                <p className="text-[10px] font-bold text-white/40 uppercase tracking-widest">Or remove the whole background</p>
                <Button
                  onClick={applyBackgroundRemoval}
                  isLoading={isRemovingBg}
                  disabled={isErasing || isRemovingBg}
                  variant="outline"
                  size="sm"
                  className="w-full border-white/20 text-white/80 hover:text-white hover:bg-white/10"
                >
                  <Sparkles size={14} className="mr-1.5" /> Remove Background
                </Button>
              </div>

              {eraseError && (
                <p className="text-xs text-red-300 flex items-start gap-1.5">
                  <AlertCircle size={14} className="mt-0.5 shrink-0" /> {eraseError}
                </p>
              )}
            </div>
          )}

          {/* Contextual selection controls */}
          {hasSelection === 'text' && (
            <div className="mt-6 pt-6 border-t border-white/10 space-y-4 animate-fade-in">
              <p className="text-[10px] font-bold text-white/40 uppercase tracking-widest">Selected Text</p>
              <div className="flex items-center gap-3">
                <input
                  type="color"
                  value={textColor}
                  onChange={(e) => { setTextColor(e.target.value); updateSelectedText({ fill: e.target.value }); }}
                  className="w-10 h-10 rounded-lg border border-white/20 bg-transparent cursor-pointer"
                />
                <input
                  type="range"
                  min={12}
                  max={140}
                  value={textSize}
                  onChange={(e) => { const v = parseInt(e.target.value); setTextSize(v); updateSelectedText({ fontSize: v }); }}
                  className="flex-1 accent-rose-500"
                />
              </div>
              <button onClick={deleteSelected} className="w-full flex items-center justify-center gap-1.5 py-2 rounded-lg bg-red-500/10 hover:bg-red-500/20 text-red-300 text-xs font-medium transition-all">
                <Trash2 size={14} /> Delete
              </button>
            </div>
          )}
          {hasSelection === 'other' && (
            <div className="mt-6 pt-6 border-t border-white/10">
              <button onClick={deleteSelected} className="w-full flex items-center justify-center gap-1.5 py-2 rounded-lg bg-red-500/10 hover:bg-red-500/20 text-red-300 text-xs font-medium transition-all">
                <Trash2 size={14} /> Delete Selected
              </button>
            </div>
          )}

          <div className="mt-8 pt-6 border-t border-white/10">
            <Button onClick={handleExport} isLoading={isExporting} variant="primary" className="w-full bg-slate-900 hover:bg-black shadow-lg">
              <Download size={16} className="mr-2" /> Save Edited Image
            </Button>
          </div>
        </div>
      </div>
    </div>,
    document.body
  );
};
