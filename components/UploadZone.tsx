import React, { useRef, useState } from 'react';
import { Package, User, Sparkles, X, ImagePlus, Image as ImageIcon } from 'lucide-react';
import { Button } from './Button';

interface UploadZoneProps {
  onGenerate: (productFile: File | undefined, modelFiles: File[], referenceFile: File | undefined, autoStart?: boolean) => void;
  isProcessing: boolean;
}

export const UploadZone: React.FC<UploadZoneProps> = ({ onGenerate, isProcessing }) => {
  const productInputRef = useRef<HTMLInputElement>(null);
  const modelInputRef = useRef<HTMLInputElement>(null);
  const referenceInputRef = useRef<HTMLInputElement>(null);
  
  const [productFile, setProductFile] = useState<File | undefined>(undefined);
  const [modelFiles, setModelFiles] = useState<File[]>([]);
  const [referenceFile, setReferenceFile] = useState<File | undefined>(undefined);

  const handleProductChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files[0]) {
      setProductFile(e.target.files[0]);
    }
    e.target.value = '';
  };

  const handleModelChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files) {
      const newFiles = Array.from(e.target.files);
      setModelFiles(prev => [...prev, ...newFiles].slice(0, 3)); // Max 3
    }
    e.target.value = '';
  };

  const handleReferenceChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files[0]) {
      setReferenceFile(e.target.files[0]);
    }
    e.target.value = '';
  };

  const removeModelFile = (index: number) => {
    setModelFiles(prev => prev.filter((_, i) => i !== index));
  };

  const handleStart = (autoStart: boolean = false) => {
    onGenerate(productFile, modelFiles, referenceFile, autoStart);
    // Reset after start
    setProductFile(undefined);
    setModelFiles([]);
    setReferenceFile(undefined);
  };

  return (
    <div className={`glass-panel rounded-[2rem] p-8 transition-all duration-700 ${isProcessing ? 'opacity-50 pointer-events-none' : ''}`}>
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-8 mb-8">
        
        {/* Product Upload */}
        <div className="space-y-4">
            <h3 className="font-display font-bold text-slate-800 flex items-center gap-2">
                <Package className="text-rose-500" size={20} />
                Clothing Product <span className="text-xs font-normal text-slate-400 bg-slate-100 px-2 py-0.5 rounded-full">Required</span>
            </h3>
            
            <div 
                onClick={() => productInputRef.current?.click()}
                className={`border-2 border-dashed rounded-2xl p-6 flex flex-col items-center justify-center cursor-pointer transition-all h-64 relative overflow-hidden ${
                    productFile ? 'border-rose-500 bg-rose-50/30' : 'border-slate-200 hover:border-rose-300 hover:bg-slate-50'
                }`}
            >
                {productFile ? (
                    <>
                        <img src={URL.createObjectURL(productFile)} alt="Product" className="absolute inset-0 w-full h-full object-contain p-4" />
                        <div className="absolute top-2 right-2 bg-white/80 backdrop-blur rounded-full p-1 shadow-sm hover:bg-red-50 text-slate-500 hover:text-red-500" onClick={(e) => { e.stopPropagation(); setProductFile(undefined); }}>
                            <X size={16} />
                        </div>
                        <div className="absolute bottom-2 left-1/2 -translate-x-1/2 bg-black/50 backdrop-blur px-3 py-1 rounded-full text-white text-xs font-medium truncate max-w-[90%]">
                            {productFile.name}
                        </div>
                    </>
                ) : (
                    <div className="text-center space-y-3">
                        <div className="w-12 h-12 bg-rose-100 text-rose-500 rounded-xl flex items-center justify-center mx-auto">
                            <ImagePlus size={24} />
                        </div>
                        <div>
                            <p className="text-sm font-medium text-slate-700">Upload Clothing Item</p>
                            <p className="text-xs text-slate-400 mt-1">PNG, JPG up to 10MB</p>
                        </div>
                    </div>
                )}
                <input 
                    type="file" 
                    ref={productInputRef} 
                    onChange={handleProductChange} 
                    className="hidden" 
                    accept="image/*" 
                />
            </div>
        </div>

        {/* Model Upload */}
        <div className="space-y-4">
            <h3 className="font-display font-bold text-slate-800 flex items-center gap-2">
                <User className="text-blue-500" size={20} />
                Model Face <span className="text-xs font-normal text-slate-400 bg-slate-100 px-2 py-0.5 rounded-full">Optional • For Face Swap</span>
            </h3>
            
            <div className="grid grid-cols-2 gap-4 h-64">
                {modelFiles.map((file, idx) => (
                    <div key={idx} className="relative rounded-xl overflow-hidden border border-slate-200 bg-slate-50 group">
                        <img src={URL.createObjectURL(file)} alt={`Model ${idx}`} className="w-full h-full object-cover" />
                        <button 
                            onClick={() => removeModelFile(idx)}
                            className="absolute top-1 right-1 bg-white/80 p-1 rounded-full text-slate-500 hover:text-red-500 opacity-0 group-hover:opacity-100 transition-opacity"
                        >
                            <X size={14} />
                        </button>
                    </div>
                ))}
                
                {modelFiles.length < 1 && (
                    <div 
                        onClick={() => modelInputRef.current?.click()}
                        className="border-2 border-dashed border-slate-200 rounded-xl flex flex-col items-center justify-center cursor-pointer hover:border-blue-300 hover:bg-slate-50 transition-all text-slate-400 hover:text-blue-500 col-span-2"
                    >
                        <User size={24} className="mb-2 opacity-50" />
                        <span className="text-xs font-medium">Add Model Face</span>
                        <input 
                            type="file" 
                            ref={modelInputRef} 
                            onChange={handleModelChange} 
                            className="hidden" 
                            accept="image/*" 
                            // multiple // Removed multiple to focus on single face for better results, or keep it if user wants options
                        />
                    </div>
                )}
            </div>
        </div>

        {/* Reference Image Upload */}
        <div className="space-y-4">
            <h3 className="font-display font-bold text-slate-800 flex items-center gap-2">
                <ImageIcon className="text-purple-500" size={20} />
                Reference <span className="text-xs font-normal text-slate-400 bg-slate-100 px-2 py-0.5 rounded-full">Optional • Adapts to prompt</span>
            </h3>
            
            <div 
                onClick={() => referenceInputRef.current?.click()}
                className={`border-2 border-dashed rounded-2xl p-6 flex flex-col items-center justify-center cursor-pointer transition-all h-64 relative overflow-hidden ${
                    referenceFile ? 'border-purple-500 bg-purple-50/30' : 'border-slate-200 hover:border-purple-300 hover:bg-slate-50'
                }`}
            >
                {referenceFile ? (
                    <>
                        <img src={URL.createObjectURL(referenceFile)} alt="Reference" className="absolute inset-0 w-full h-full object-contain p-4" />
                        <div className="absolute top-2 right-2 bg-white/80 backdrop-blur rounded-full p-1 shadow-sm hover:bg-red-50 text-slate-500 hover:text-red-500" onClick={(e) => { e.stopPropagation(); setReferenceFile(undefined); }}>
                            <X size={16} />
                        </div>
                        <div className="absolute bottom-2 left-1/2 -translate-x-1/2 bg-black/50 backdrop-blur px-3 py-1 rounded-full text-white text-xs font-medium truncate max-w-[90%]">
                            {referenceFile.name}
                        </div>
                    </>
                ) : (
                    <div className="text-center space-y-3">
                        <div className="w-12 h-12 bg-purple-100 text-purple-500 rounded-xl flex items-center justify-center mx-auto">
                            <ImagePlus size={24} />
                        </div>
                        <div>
                            <p className="text-sm font-medium text-slate-700">Add Style Reference</p>
                            <p className="text-xs text-slate-400 mt-1">PNG, JPG up to 10MB</p>
                        </div>
                    </div>
                )}
                <input 
                    type="file" 
                    ref={referenceInputRef} 
                    onChange={handleReferenceChange} 
                    className="hidden" 
                    accept="image/*" 
                />
            </div>
        </div>
      </div>

      <div className="flex justify-center gap-4 flex-wrap">
        <Button 
            onClick={() => handleStart(false)}
            variant="outline" 
            size="lg"
            className="px-8 py-4 rounded-2xl text-lg transition-transform border-slate-200 hover:bg-slate-50 text-slate-700"
        >
            Start New Project
        </Button>
        <Button 
            onClick={() => onGenerate(undefined, [], undefined, true)}
            variant="outline" 
            size="lg"
            className="px-8 py-4 rounded-2xl text-lg transition-transform border-slate-200 hover:bg-slate-50 text-slate-700"
        >
            <Sparkles size={20} className="mr-2 text-blue-500" />
            Generate from Text
        </Button>
        <Button 
            onClick={() => handleStart(true)}
            variant="primary" 
            size="lg"
            className="px-8 py-4 rounded-2xl text-lg shadow-xl shadow-rose-200/50 hover:scale-105 transition-transform"
        >
            <Sparkles size={20} className="mr-2" />
            Generate
        </Button>
      </div>
    </div>
  );
};
