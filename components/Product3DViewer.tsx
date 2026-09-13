import React, { useState, useRef } from 'react';
import { Maximize2, RotateCw, Sparkles, Loader2, Wand2 } from 'lucide-react';

export interface Product3DViewerItem {
  url: string;
  key: string;
  label: string;
}

interface Product3DViewerProps {
  images: Product3DViewerItem[];
  onViewImage: (url: string, title: string) => void;
  onEdit?: (item: Product3DViewerItem) => void;
  isProcessing: boolean;
}

export const Product3DViewer: React.FC<Product3DViewerProps> = ({ images, onViewImage, onEdit, isProcessing }) => {
  const [currentIndex, setCurrentIndex] = useState(0);
  const [isDragging, setIsDragging] = useState(false);
  const startX = useRef(0);

  if (images.length === 0) {
    return (
      <div className="w-full max-w-2xl mx-auto aspect-square rounded-2xl bg-gradient-to-br from-slate-50/50 to-white/50 border border-white/60 flex flex-col items-center justify-center text-slate-300 shadow-sm">
        {isProcessing ? (
          <div className="relative">
            <div className="absolute inset-0 bg-rose-300 rounded-full blur-2xl opacity-20 animate-pulse"></div>
            <div className="relative z-10 flex flex-col items-center gap-2">
              <Sparkles className="animate-spin text-rose-400" size={24} />
              <span className="text-xs font-mono text-rose-400 uppercase tracking-widest animate-pulse">Rendering 3D Views</span>
            </div>
          </div>
        ) : (
          <div className="w-12 h-12 rounded-full bg-slate-100/50"></div>
        )}
      </div>
    );
  }

  const handleMouseDown = (e: React.MouseEvent | React.TouchEvent) => {
    setIsDragging(true);
    startX.current = 'touches' in e ? e.touches[0].clientX : e.clientX;
  };

  const handleMouseMove = (e: React.MouseEvent | React.TouchEvent) => {
    if (!isDragging) return;
    const currentX = 'touches' in e ? e.touches[0].clientX : e.clientX;
    const diff = currentX - startX.current;

    if (Math.abs(diff) > 40) {
      if (diff > 0) {
        setCurrentIndex((prev) => (prev === 0 ? images.length - 1 : prev - 1));
      } else {
        setCurrentIndex((prev) => (prev === images.length - 1 ? 0 : prev + 1));
      }
      startX.current = currentX;
    }
  };

  const handleMouseUp = () => {
    setIsDragging(false);
  };

  // Ensure index is within bounds if images array changes
  const safeIndex = Math.min(currentIndex, images.length - 1);
  const currentImage = images[safeIndex].url;

  return (
    <div className="flex flex-col gap-6 max-w-2xl mx-auto">
      <div 
        className="relative rounded-2xl overflow-hidden bg-white/40 border border-white/60 aspect-square shadow-sm cursor-ew-resize group transition-all duration-500 hover:shadow-xl hover:shadow-rose-100/40 hover:border-rose-300/50"
        onMouseDown={handleMouseDown}
        onMouseMove={handleMouseMove}
        onMouseUp={handleMouseUp}
        onMouseLeave={handleMouseUp}
        onTouchStart={handleMouseDown}
        onTouchMove={handleMouseMove}
        onTouchEnd={handleMouseUp}
      >
        <img 
          src={currentImage} 
          alt={`3D View ${safeIndex + 1}`} 
          className="w-full h-full object-cover pointer-events-none select-none"
        />
        
        {/* 3D Badge */}
        <div className="absolute top-4 left-4 px-3 py-1.5 bg-black/40 backdrop-blur-md rounded-full border border-white/10 text-xs text-white font-medium flex items-center gap-2 z-10">
          <RotateCw size={14} /> 3D Interactive View
        </div>

        {/* Expand / Edit Buttons */}
        <div className="absolute top-4 right-4 flex items-center gap-2 opacity-0 group-hover:opacity-100 transition-opacity z-10">
          {onEdit && (
            <button
              onClick={(e) => {
                e.stopPropagation();
                onEdit(images[safeIndex]);
              }}
              className="p-2 bg-black/40 backdrop-blur-md rounded-full border border-white/10 text-white hover:bg-black/60"
            >
              <Wand2 size={16} />
            </button>
          )}
          <button
            onClick={(e) => {
              e.stopPropagation();
              onViewImage(currentImage, images[safeIndex].label);
            }}
            className="p-2 bg-black/40 backdrop-blur-md rounded-full border border-white/10 text-white hover:bg-black/60"
          >
            <Maximize2 size={16} />
          </button>
        </div>

        {/* Drag Hint */}
        <div className="absolute bottom-6 left-1/2 -translate-x-1/2 px-5 py-2.5 bg-black/50 backdrop-blur-md rounded-full border border-white/10 text-xs text-white font-medium opacity-80 group-hover:opacity-100 transition-opacity pointer-events-none flex items-center gap-2">
          <RotateCw size={14} className={`${isDragging ? 'animate-spin' : ''}`} /> Drag left or right to rotate
        </div>
      </div>
      
      {/* Thumbnails */}
      <div className="flex gap-3 justify-center">
        {images.map((img, idx) => (
          <button
            key={img.key}
            onClick={() => setCurrentIndex(idx)}
            className={`w-20 h-20 rounded-xl overflow-hidden border-2 transition-all ${
              safeIndex === idx ? 'border-rose-500 shadow-md scale-105' : 'border-transparent opacity-60 hover:opacity-100 hover:scale-100 scale-95'
            }`}
          >
            <img src={img.url} alt={img.label} className="w-full h-full object-cover" />
          </button>
        ))}
        {isProcessing && images.length < 4 && (
           <div className="w-20 h-20 rounded-xl border-2 border-dashed border-slate-200 flex items-center justify-center bg-slate-50/50">
               <Loader2 size={20} className="text-slate-400 animate-spin" />
           </div>
        )}
      </div>
    </div>
  );
};
