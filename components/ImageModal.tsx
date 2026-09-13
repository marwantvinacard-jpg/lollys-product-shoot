import React, { useState, useRef, useEffect } from 'react';
import { X, ZoomIn, ZoomOut, Maximize, Download, RefreshCcw } from 'lucide-react';
import { Button } from './Button';

interface ImageModalProps {
  isOpen: boolean;
  imageUrl: string;
  title: string;
  onClose: () => void;
  onDownload: () => void;
}

export const ImageModal: React.FC<ImageModalProps> = ({ isOpen, imageUrl, title, onClose, onDownload }) => {
  const [scale, setScale] = useState(1);
  const [position, setPosition] = useState({ x: 0, y: 0 });
  const [isDragging, setIsDragging] = useState(false);
  const dragStart = useRef({ x: 0, y: 0 });
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (isOpen) {
      setScale(1);
      setPosition({ x: 0, y: 0 });
      document.body.style.overflow = 'hidden';
    } else {
      document.body.style.overflow = 'unset';
    }
    return () => { document.body.style.overflow = 'unset'; };
  }, [isOpen]);

  if (!isOpen) return null;

  const handleWheel = (e: React.WheelEvent) => {
    e.preventDefault();
    const delta = e.deltaY * -0.001;
    const newScale = Math.min(Math.max(0.5, scale + delta), 4);
    setScale(newScale);
  };

  const handleMouseDown = (e: React.MouseEvent) => {
    setIsDragging(true);
    dragStart.current = { x: e.clientX - position.x, y: e.clientY - position.y };
  };

  const handleMouseMove = (e: React.MouseEvent) => {
    if (isDragging) {
      setPosition({
        x: e.clientX - dragStart.current.x,
        y: e.clientY - dragStart.current.y
      });
    }
  };

  const handleMouseUp = () => {
    setIsDragging(false);
  };

  const handleZoomIn = () => setScale(prev => Math.min(prev + 0.5, 4));
  const handleZoomOut = () => setScale(prev => Math.max(prev - 0.5, 0.5));
  const handleReset = () => {
    setScale(1);
    setPosition({ x: 0, y: 0 });
  };

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-slate-900/95 backdrop-blur-xl animate-fade-in">
      {/* Header */}
      <div className="absolute top-0 left-0 right-0 p-6 flex justify-between items-center z-50 pointer-events-none">
        <div className="pointer-events-auto bg-white/10 backdrop-blur-md px-4 py-2 rounded-full border border-white/20">
             <h3 className="text-white font-display text-lg tracking-wide">{title} <span className="text-rose-300 text-sm ml-2 font-mono">4K PREVIEW</span></h3>
        </div>
        <button 
          onClick={onClose}
          className="pointer-events-auto p-2 bg-white/10 hover:bg-white/20 rounded-full text-white transition-colors border border-white/10"
        >
          <X size={24} />
        </button>
      </div>

      {/* Main Viewport */}
      <div 
        className="relative w-full h-full overflow-hidden cursor-move flex items-center justify-center"
        onWheel={handleWheel}
        onMouseDown={handleMouseDown}
        onMouseMove={handleMouseMove}
        onMouseUp={handleMouseUp}
        onMouseLeave={handleMouseUp}
        ref={containerRef}
      >
        <div 
           style={{ 
             transform: `translate(${position.x}px, ${position.y}px) scale(${scale})`,
             transition: isDragging ? 'none' : 'transform 0.2s ease-out'
           }}
           className="relative shadow-2xl shadow-black/50"
        >
            <img 
              src={imageUrl} 
              alt={title} 
              className="max-h-[85vh] max-w-[90vw] object-contain select-none pointer-events-none rounded-lg"
              draggable={false}
            />
        </div>
      </div>

      {/* Controls */}
      <div className="absolute bottom-8 left-1/2 -translate-x-1/2 flex items-center gap-3 z-50 bg-black/40 backdrop-blur-xl p-2 rounded-2xl border border-white/10 shadow-2xl">
        <div className="flex items-center gap-1 border-r border-white/10 pr-2 mr-2">
            <button onClick={handleZoomOut} className="p-2 text-white/70 hover:text-white hover:bg-white/10 rounded-lg transition-all"><ZoomOut size={20} /></button>
            <span className="text-white/50 text-xs w-12 text-center font-mono">{Math.round(scale * 100)}%</span>
            <button onClick={handleZoomIn} className="p-2 text-white/70 hover:text-white hover:bg-white/10 rounded-lg transition-all"><ZoomIn size={20} /></button>
            <button onClick={handleReset} className="p-2 text-white/70 hover:text-white hover:bg-white/10 rounded-lg transition-all" title="Reset View"><RefreshCcw size={18} /></button>
        </div>
        
        <Button onClick={onDownload} variant="primary" className="h-10 text-sm px-6 bg-rose-500 hover:bg-rose-600 border-none shadow-lg shadow-rose-500/30">
            <Download size={16} className="mr-2" /> Export 4K
        </Button>
      </div>
      
      {/* Decorative Elements */}
      <div className="absolute bottom-0 left-0 w-full h-1 bg-gradient-to-r from-rose-500 via-purple-500 to-blue-500 opacity-50"></div>
    </div>
  );
};
