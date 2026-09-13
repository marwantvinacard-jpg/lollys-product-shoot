import React, { useState } from 'react';
import { ProductImage } from '../types';
import { Download, AlertCircle, Sparkles, Zap, Camera, CheckCircle2, Maximize2, Video, User, Box, Play, Loader2, MousePointerClick, ShoppingBag, Clapperboard, Settings2, Wand2, Film, Gem } from 'lucide-react';
import { Button } from './Button';
import { Product3DViewer } from './Product3DViewer';
import { openInCapCut } from '../utils/capcut';
import { upscaleImage } from '../services/magnificService';
import { getGenerationTasksForGroup } from '../services/taxonomy';

// Lazy-loaded: ImageEditor pulls in fabric.js (a real chunk of weight) and
// VideoEditor pulls in the canvas/MediaRecorder export pipeline -- neither is
// needed until someone actually clicks "Edit," so there's no reason for every
// visitor to download them just to view their generated shots.
const ImageEditor = React.lazy(() => import('./ImageEditor').then((m) => ({ default: m.ImageEditor })));
const VideoEditor = React.lazy(() => import('./VideoEditor').then((m) => ({ default: m.VideoEditor })));

const EditorLoadingOverlay: React.FC = () => (
  <div className="fixed inset-0 z-[100] flex items-center justify-center bg-slate-900/97 backdrop-blur-xl">
    <Loader2 className="animate-spin text-white/60" size={32} />
  </div>
);

interface ProductCardProps {
  product: ProductImage;
  onViewImage: (url: string, title: string) => void;
  onGenerateVideo: (product: ProductImage, type: 'product' | 'model', options: {
      aspectRatio: '16:9' | '9:16' | '1:1',
      resolution: '720p' | '1080p',
      startImage?: string,
      endImage?: string,
      prompt?: string
  }) => void;
  onRegenerate: (productId: string, newOptions: Partial<ProductImage>) => void;
  onSaveEdit: (productId: string, resultKey: string, newUrl: string) => void;
  imageEditorEnabled?: boolean;
  videoEditorEnabled?: boolean;
}

type TabType = 'studio' | 'models' | 'interactive' | 'video';

export const ProductCard: React.FC<ProductCardProps> = ({ product, onViewImage, onGenerateVideo, onRegenerate, onSaveEdit, imageEditorEnabled = true, videoEditorEnabled = true }) => {
  const [activeTab, setActiveTab] = useState<TabType>('studio');
  // Which shots this product actually has depends on its category (a house
  // has no "model posed" shots, a T-shirt has no "interior cabin" shot) --
  // see services/taxonomy.ts, the single source of truth for this mapping.
  const categoryTasks = getGenerationTasksForGroup(product.productCategoryGroup);
  const hasModelShots = categoryTasks.some((t) => t.isModelShot);
  const primaryShots = categoryTasks.filter((t) => !t.isModelShot);
  const [imageEditorTarget, setImageEditorTarget] = useState<{ key: string; url: string; title: string } | null>(null);
  const [videoEditorTarget, setVideoEditorTarget] = useState<{ key: string; url: string; title: string } | null>(null);
  const [capCutToast, setCapCutToast] = useState<string | null>(null);
  const [upscalingKey, setUpscalingKey] = useState<string | null>(null);
  const [upscaleError, setUpscaleError] = useState<string | null>(null);

  const sendToCapCut = (url: string, baseName: string, fallbackExt: 'png' | 'jpg' | 'mp4' | 'webm') => {
    openInCapCut(url, baseName, fallbackExt);
    setCapCutToast('Downloading your file and opening CapCut — drop it onto the CapCut timeline to start editing.');
    window.setTimeout(() => setCapCutToast(null), 7000);
  };

  const handleUpscale = async (resultKey: keyof ProductImage['results'], url: string) => {
    setUpscaleError(null);
    setUpscalingKey(resultKey as string);
    try {
      const upscaledUrl = await upscaleImage(url);
      onSaveEdit(product.id, resultKey as string, upscaledUrl);
    } catch (err: any) {
      setUpscaleError(err?.message || 'Failed to enhance image. Please try again.');
    } finally {
      setUpscalingKey(null);
    }
  };
  // Default to editing mode if the product is new (idle)
  const [isEditing, setIsEditing] = useState(product.status === 'idle');
  const [editForm, setEditForm] = useState({
      virtue: product.virtue || 'Default',
      productAngle: product.productAngle || 'Default',
      productPrompt: product.productPrompt || '',
      modelPrompt: product.modelPrompt || '',
      modelPosture: product.modelPosture || '',
      backgroundPrompt: product.backgroundPrompt || ''
  });

  const [videoSettings, setVideoSettings] = useState<{
      aspectRatio: '16:9' | '9:16' | '1:1';
      resolution: '720p' | '1080p';
      prompt?: string;
      startImage?: string;
      endImage?: string;
  }>({
      aspectRatio: '9:16',
      resolution: '1080p'
  });

  const handleRegenerateClick = () => {
      onRegenerate(product.id, editForm);
      setIsEditing(false);
  };

  const downloadImage = (url: string, filename: string) => {
    const link = document.createElement('a');
    link.href = url;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  const handleExportAll = () => {
    if (product.results.studio_front) downloadImage(product.results.studio_front, `Lollys-Front-4K-${product.id}.png`);
    if (product.results.studio_right) setTimeout(() => downloadImage(product.results.studio_right!, `Lollys-Right-4K-${product.id}.png`), 500);
    if (product.results.studio_back) setTimeout(() => downloadImage(product.results.studio_back!, `Lollys-Back-4K-${product.id}.png`), 1000);
    if (product.results.studio_left) setTimeout(() => downloadImage(product.results.studio_left!, `Lollys-Left-4K-${product.id}.png`), 1500);
  };

  const renderResultImage = (url: string | undefined, title: string, subtitle: string, type: string, resultKey: keyof ProductImage['results']) => (
    <div className="flex flex-col gap-3 group">
      <div 
        className={`relative rounded-2xl overflow-hidden bg-white/40 border border-white/60 aspect-square shadow-sm transition-all duration-500 hover:shadow-xl hover:shadow-rose-100/40 hover:border-rose-300/50 ${url ? 'cursor-zoom-in' : ''}`}
        onClick={() => url && onViewImage(url, title)}
      >
        {url ? (
          <>
             <img 
                 src={url} 
                 alt={title} 
                 className="w-full h-full object-cover"
             />
             {/* 4K Badge */}
             <div className="absolute top-2 right-2 px-2 py-0.5 bg-black/40 backdrop-blur-md rounded border border-white/10 text-[10px] text-white font-mono opacity-90 z-10">
               4K STUDIO
             </div>
             
             {/* Hover Overlay */}
             <div className="absolute inset-0 bg-black/0 group-hover:bg-black/10 transition-colors duration-300 flex items-center justify-center">
                 <div className="opacity-0 group-hover:opacity-100 transform scale-90 group-hover:scale-100 transition-all duration-300 bg-white/20 backdrop-blur-md p-3 rounded-full text-white border border-white/30">
                    <Maximize2 size={24} />
                 </div>
             </div>
          </>
        ) : (
          <div className="w-full h-full flex flex-col items-center justify-center text-slate-300 bg-gradient-to-br from-slate-50/50 to-white/50">
              {product.status === 'processing' ? (
                  <>
                      <div className="relative">
                          <div className="absolute inset-0 bg-rose-300 rounded-full blur-2xl opacity-20 animate-pulse"></div>
                          <div className="relative z-10 flex flex-col items-center gap-2">
                            <Sparkles className="animate-spin text-rose-400" size={20} />
                            <span className="text-[10px] font-mono text-rose-400 uppercase tracking-widest animate-pulse">Refining</span>
                          </div>
                      </div>
                  </>
              ) : (
                  <div className="w-12 h-12 rounded-full bg-slate-100/50"></div>
              )}
          </div>
        )}
      </div>
      
      {/* Details & Action */}
      <div className="flex items-center justify-between px-1">
        <div>
          <p className="text-xs font-bold text-slate-800 font-display">{title}</p>
          <p className="text-[10px] text-slate-400">{subtitle}</p>
        </div>
        {url && (
            <div className="flex items-center gap-1.5">
                {imageEditorEnabled && (
                <Button
                    onClick={(e) => {
                        e.stopPropagation();
                        setImageEditorTarget({ key: resultKey, url, title });
                    }}
                    variant="outline"
                    size="sm"
                    className="rounded-lg h-8 px-3 text-[10px] border-slate-200 hover:border-purple-200 hover:bg-purple-50 hover:text-purple-600 transition-all"
                >
                    <Wand2 size={12} className="mr-1.5" /> Edit
                </Button>
                )}
                <Button
                    onClick={(e) => {
                        e.stopPropagation();
                        downloadImage(url, `Lollys-${type}-4K-${product.id}.png`);
                    }}
                    variant="outline"
                    size="sm"
                    className="rounded-lg h-8 px-3 text-[10px] border-slate-200 hover:border-rose-200 hover:bg-rose-50 hover:text-rose-600 transition-all"
                >
                    <Download size={12} className="mr-1.5" /> 4K Export
                </Button>
                <Button
                    onClick={(e) => {
                        e.stopPropagation();
                        sendToCapCut(url, `Lollys-${type}-${product.id}`, 'png');
                    }}
                    variant="outline"
                    size="sm"
                    className="rounded-lg h-8 px-3 text-[10px] border-slate-200 hover:border-cyan-200 hover:bg-cyan-50 hover:text-cyan-600 transition-all"
                    title="Download and open in the CapCut web editor"
                >
                    <Film size={12} className="mr-1.5" /> CapCut
                </Button>
                <Button
                    onClick={(e) => {
                        e.stopPropagation();
                        handleUpscale(resultKey, url);
                    }}
                    variant="outline"
                    size="sm"
                    disabled={upscalingKey === resultKey}
                    className="rounded-lg h-8 px-3 text-[10px] border-slate-200 hover:border-amber-200 hover:bg-amber-50 hover:text-amber-600 transition-all"
                    title="Enhance and upscale this image with Magnific"
                >
                    {upscalingKey === resultKey ? (
                        <Loader2 size={12} className="mr-1.5 animate-spin" />
                    ) : (
                        <Gem size={12} className="mr-1.5" />
                    )}
                    {upscalingKey === resultKey ? 'Enhancing…' : 'Enhance'}
                </Button>
            </div>
        )}
      </div>
    </div>
  );

  const renderVideoCard = (
    type: 'product' | 'model',
    title: string,
    description: string,
    videoUrl?: string,
    status?: 'idle' | 'generating' | 'completed' | 'failed',
    errorMessage?: string,
    resultKey: keyof ProductImage['results'] = 'video_product'
  ) => {
    return (
        <div className="flex flex-col h-full bg-slate-50/50 rounded-2xl border border-slate-100 p-6 relative overflow-hidden group hover:border-rose-100 transition-colors">
            <h4 className="font-display font-bold text-slate-900 mb-1 flex items-center gap-2">
                {type === 'product' ? <Box size={16} className="text-rose-500"/> : <User size={16} className="text-rose-500"/>}
                {title}
            </h4>
            <p className="text-xs text-slate-500 mb-4 h-8">{description}</p>

            <div className="flex-1 min-h-[250px] flex items-center justify-center bg-white rounded-xl border border-slate-100 mb-4 overflow-hidden relative shadow-inner">
                {videoUrl ? (
                    <div className="w-full h-full relative group/video">
                        <video src={videoUrl} controls className="w-full h-full object-cover" />
                    </div>
                ) : (
                    <div className="flex flex-col items-center justify-center text-center p-4">
                        {status === 'generating' ? (
                            <div className="relative">
                                <div className="w-12 h-12 rounded-full border-t-2 border-rose-500 animate-spin"></div>
                                <div className="mt-4 text-xs font-medium text-rose-500 animate-pulse">Rendering Scene...</div>
                            </div>
                        ) : status === 'failed' ? (
                            <div className="text-red-500 flex flex-col items-center max-w-[200px]">
                                <AlertCircle size={24} className="mb-2 text-red-400"/>
                                <span className="text-xs font-bold mb-1">Generation Failed</span>
                                <span className="text-[10px] text-center text-red-400/80 leading-tight">{errorMessage || "Please try again later"}</span>
                            </div>
                        ) : (
                            <>
                                <div className="w-12 h-12 bg-slate-50 rounded-full flex items-center justify-center mb-3 text-slate-300">
                                    <Clapperboard size={20} />
                                </div>
                                <span className="text-[10px] text-slate-400 uppercase tracking-widest">Ready to Generate</span>
                            </>
                        )}
                    </div>
                )}
            </div>

            {status !== 'generating' && (
                videoUrl ? (
                    <div className="space-y-2">
                        <div className="flex gap-2">
                            {videoEditorEnabled && (
                            <Button
                                onClick={() => setVideoEditorTarget({ key: resultKey, url: videoUrl, title })}
                                variant="outline"
                                className="flex-1 border-slate-200 hover:border-purple-200 hover:bg-purple-50 hover:text-purple-600"
                            >
                                <Wand2 size={14} className="mr-2" /> Edit
                            </Button>
                            )}
                            <Button onClick={() => window.open(videoUrl, '_blank')} variant="outline" className="flex-1 border-slate-200">
                                <Download size={14} className="mr-2" /> Download
                            </Button>
                        </div>
                        <Button
                            onClick={() => sendToCapCut(videoUrl, `Lollys-${type}-video-${product.id}`, 'mp4')}
                            variant="outline"
                            className="w-full border-slate-200 hover:border-cyan-200 hover:bg-cyan-50 hover:text-cyan-600"
                            title="Download and open in the CapCut web editor"
                        >
                            <Film size={14} className="mr-2" /> Edit in CapCut
                        </Button>
                    </div>
                ) : (
                    <Button 
                        onClick={() => onGenerateVideo(product, type, videoSettings)} 
                        variant="primary" 
                        className="w-full shadow-lg shadow-rose-100"
                        disabled={type === 'model' && !product.results.model_pose_premium && !product.results.model_pose_classic} // Optional: Disable if no model image
                    >
                        <Sparkles size={14} className="mr-2" /> Generate Video
                    </Button>
                )
            )}
        </div>
    );
  };

  return (
    <div className="glass-panel rounded-[2rem] p-1.5 mb-16 animate-fade-in-up transition-transform duration-500 hover:scale-[1.005]">
      <div className="bg-white/60 backdrop-blur-md rounded-[1.7rem] p-8 border border-white/60">
        
        {/* Card Header */}
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-6 mb-8 border-b border-slate-100/60 pb-6">
            <div className="flex items-center gap-4">
                <div className="w-12 h-12 rounded-2xl bg-gradient-to-br from-rose-50 to-blue-50 border border-white flex items-center justify-center shadow-sm">
                    <ShoppingBag size={20} className="text-rose-400 fill-rose-100" />
                </div>
                <div>
                    <h3 className="font-display font-bold text-slate-900 text-xl tracking-tight">Project {product.id.slice(0,6)}</h3>
                    <div className="flex items-center gap-2 mt-1">
                      <span className="text-xs text-slate-400 font-medium bg-slate-100 px-2 py-0.5 rounded text-[10px] uppercase tracking-wider">E-Commerce Ready</span>
                      <span className="text-xs text-rose-400 font-medium flex items-center gap-1">
                        <CheckCircle2 size={10} /> 4K Studio Quality
                      </span>
                    </div>
                </div>
            </div>

            {/* Global Status/Action */}
            <div className="flex items-center gap-3">
                 {product.status === 'idle' && (
                    <div className="flex items-center text-xs font-bold text-slate-500 bg-slate-100 px-4 py-2.5 rounded-xl border border-slate-200">
                        <span className="w-2 h-2 rounded-full bg-slate-400 mr-2"></span>
                        DRAFT
                    </div>
                 )}
                 {(product.status === 'processing' || product.status === 'pending') && (
                  <div className="flex items-center text-xs font-bold text-rose-500 bg-rose-50/80 px-4 py-2.5 rounded-xl border border-rose-100 shadow-sm shadow-rose-100/20">
                    <span className="relative flex h-2 w-2 mr-2">
                      <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-rose-400 opacity-75"></span>
                      <span className="relative inline-flex rounded-full h-2 w-2 bg-rose-500"></span>
                    </span>
                    {product.status === 'pending' ? 'QUEUED...' : 'DEVELOPING ASSETS...'}
                  </div>
                )}
                {product.status === 'completed' && (
                   <>
                       <Button onClick={() => setIsEditing(!isEditing)} variant="outline" size="md" className="rounded-xl border-slate-200 hover:bg-slate-50">
                           <Settings2 size={16} className="mr-2" /> {isEditing ? 'Cancel' : 'Re-Prompt'}
                       </Button>
                       <Button onClick={handleExportAll} variant="primary" size="md" className="rounded-xl shadow-lg shadow-rose-200/40 bg-slate-900 hover:bg-slate-800">
                          <Download size={16} className="mr-2" /> Download Bundle
                       </Button>
                   </>
                )}
            </div>
        </div>

        {isEditing && (
            <div className="mb-8 p-6 bg-slate-50/80 rounded-2xl border border-slate-200 animate-fade-in">
                <h4 className="font-bold text-slate-800 mb-4">
                    {product.status === 'idle' ? 'Customize & Generate' : 'Edit Prompts & Regenerate'}
                </h4>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mb-6">
                    {/* Virtue Selector */}
                    <div className="space-y-2">
                        <label className="text-xs font-bold text-slate-500 uppercase tracking-wider">Virtue / Style</label>
                        <div className="flex flex-wrap gap-2">
                            {['Default', 'Professional', 'Playful', 'Elegant', 'Edgy', 'Natural', 'Futuristic', 'Vintage', 'Minimalist'].map((virtue) => (
                                <button
                                    key={virtue}
                                    onClick={() => setEditForm(prev => ({...prev, virtue}))}
                                    className={`px-3 py-1.5 rounded-full text-xs font-medium transition-all duration-200 border ${
                                        editForm.virtue === virtue
                                            ? 'bg-rose-500 text-white border-rose-500 shadow-md transform scale-105'
                                            : 'bg-white text-slate-600 border-slate-200 hover:border-rose-300 hover:text-rose-600'
                                    }`}
                                >
                                    {virtue}
                                </button>
                            ))}
                        </div>
                    </div>

                    {/* Angle Selector */}
                    <div className="space-y-2">
                        <label className="text-xs font-bold text-slate-500 uppercase tracking-wider">Product Angle</label>
                        <div className="flex flex-wrap gap-2">
                            {['Default', 'Front View', 'Side Profile', 'Top Down', 'Low Angle', 'Isometric', 'Close Up'].map((angle) => (
                                <button
                                    key={angle}
                                    onClick={() => setEditForm(prev => ({...prev, productAngle: angle}))}
                                    className={`px-3 py-1.5 rounded-full text-xs font-medium transition-all duration-200 border ${
                                        editForm.productAngle === angle
                                            ? 'bg-blue-500 text-white border-blue-500 shadow-md transform scale-105'
                                            : 'bg-white text-slate-600 border-slate-200 hover:border-blue-300 hover:text-blue-600'
                                    }`}
                                >
                                    {angle}
                                </button>
                            ))}
                        </div>
                    </div>

                    {/* Text Prompts */}
                    <div className="space-y-4 md:col-span-2 grid grid-cols-1 md:grid-cols-2 gap-6">
                        <div className="space-y-4">
                            <div className="space-y-1">
                                <label className="text-xs font-bold text-slate-500 uppercase tracking-wider">Product Prompt</label>
                                <input
                                    type="text"
                                    value={editForm.productPrompt}
                                    onChange={(e) => setEditForm(prev => ({...prev, productPrompt: e.target.value}))}
                                    placeholder="e.g. A sleek black leather handbag..."
                                    className="w-full px-4 py-2 rounded-lg bg-white border border-slate-200 text-sm focus:outline-none focus:ring-2 focus:ring-rose-500/20 focus:border-rose-500 transition-all placeholder:text-slate-400"
                                />
                            </div>
                            <div className="space-y-1">
                                <label className="text-xs font-bold text-slate-500 uppercase tracking-wider">Model Prompt</label>
                                <input
                                    type="text"
                                    value={editForm.modelPrompt}
                                    onChange={(e) => setEditForm(prev => ({...prev, modelPrompt: e.target.value}))}
                                    placeholder="e.g. Young Asian woman, smiling, business casual..."
                                    className="w-full px-4 py-2 rounded-lg bg-white border border-slate-200 text-sm focus:outline-none focus:ring-2 focus:ring-rose-500/20 focus:border-rose-500 transition-all placeholder:text-slate-400"
                                />
                                {product.inputType === 'product' && (
                                    <div className="mt-2 text-[10px] text-slate-400 italic">
                                        To add reference models, please create a new project.
                                    </div>
                                )}
                            </div>
                            <div className="space-y-1">
                                <label className="text-xs font-bold text-slate-500 uppercase tracking-wider">Model Posture / Pose</label>
                                <input
                                    type="text"
                                    value={editForm.modelPosture}
                                    onChange={(e) => setEditForm(prev => ({...prev, modelPosture: e.target.value}))}
                                    placeholder="e.g. Sitting on a chair, walking towards camera, holding product up..."
                                    className="w-full px-4 py-2 rounded-lg bg-white border border-slate-200 text-sm focus:outline-none focus:ring-2 focus:ring-rose-500/20 focus:border-rose-500 transition-all placeholder:text-slate-400"
                                />
                            </div>
                        </div>
                        
                        <div className="space-y-1">
                            <label className="text-xs font-bold text-slate-500 uppercase tracking-wider">Background / Location</label>
                            <textarea
                                value={editForm.backgroundPrompt}
                                onChange={(e) => setEditForm(prev => ({...prev, backgroundPrompt: e.target.value}))}
                                placeholder="e.g. Modern kitchen, sunny park, luxury office..."
                                className="w-full h-full min-h-[108px] px-4 py-2 rounded-lg bg-white border border-slate-200 text-sm focus:outline-none focus:ring-2 focus:ring-rose-500/20 focus:border-rose-500 transition-all placeholder:text-slate-400 resize-none"
                            />
                        </div>
                    </div>
                </div>
                <div className="flex justify-end">
                    <Button onClick={handleRegenerateClick} variant="primary" className="bg-rose-500 hover:bg-rose-600">
                        <Sparkles size={16} className="mr-2" /> 
                        {product.status === 'idle' ? 'Start Generation' : 'Regenerate Images'}
                    </Button>
                </div>
            </div>
        )}

        <div className="flex flex-col lg:flex-row gap-8">
            
            {/* Source Column */}
            <div className="lg:w-1/4 flex flex-col gap-6">
                <div className="sticky top-24 space-y-4">
                    <div className="relative aspect-[3/4] rounded-2xl overflow-hidden bg-slate-100 shadow-inner border border-slate-200/50 group">
                         {product.previewUrl ? (
                             <img 
                                src={product.previewUrl} 
                                alt="Original" 
                                className="w-full h-full object-cover transition-all duration-500 group-hover:scale-105 group-hover:opacity-60"
                            />
                         ) : (
                             <div className="w-full h-full flex flex-col items-center justify-center bg-slate-50 text-slate-400 p-4 text-center">
                                 <Sparkles size={32} className="mb-2 text-rose-300" />
                                 <p className="text-xs font-medium">Generated from Text</p>
                                 <p className="text-[10px] opacity-60 mt-1">"{product.modelPrompt || product.backgroundPrompt || 'Custom Prompt'}"</p>
                             </div>
                         )}
                        <div className="absolute inset-0 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity duration-300">
                             <div className="bg-white/90 backdrop-blur-md px-3 py-1.5 rounded-full text-[10px] font-bold tracking-widest text-slate-800 shadow-lg">SOURCE FILE</div>
                        </div>
                        <div className="absolute top-3 left-3 bg-black/50 backdrop-blur-md px-2 py-1 rounded-lg flex items-center gap-1.5 border border-white/10">
                            <Camera size={10} className="text-white" />
                            <span className="text-[9px] font-bold text-white uppercase tracking-wider">
                                {product.productBase64 || (product as any).productFile ? 'Product' : 'Text'}
                            </span>
                        </div>
                    </div>

                    {/* Additional Model Thumbnails */}
                    {((product.modelBase64s && product.modelBase64s.length > 0) || ((product as any).modelFiles && (product as any).modelFiles.length > 0)) && (
                        <div className="grid grid-cols-3 gap-2">
                            {product.modelBase64s ? product.modelBase64s.map((b64, idx) => (
                                <div key={idx} className="aspect-square rounded-lg overflow-hidden border border-slate-200 relative group">
                                    <img src={`data:image/jpeg;base64,${b64}`} alt={`Model ${idx}`} className="w-full h-full object-cover" />
                                    <div className="absolute bottom-0 left-0 right-0 bg-black/50 text-white text-[8px] text-center py-0.5">Model</div>
                                </div>
                            )) : (product as any).modelFiles?.map((file: File, idx: number) => (
                                <div key={idx} className="aspect-square rounded-lg overflow-hidden border border-slate-200 relative group">
                                    <img src={URL.createObjectURL(file)} alt={`Model ${idx}`} className="w-full h-full object-cover" />
                                    <div className="absolute bottom-0 left-0 right-0 bg-black/50 text-white text-[8px] text-center py-0.5">Model</div>
                                </div>
                            ))}
                        </div>
                    )}

                    <div className="bg-slate-50/80 rounded-xl p-4 border border-slate-100 text-xs text-slate-500">
                       <p className="font-semibold text-slate-700 mb-1">AI Studio Processing</p>
                       <ul className="space-y-1 list-disc list-inside">
                          <li>Noise Reduction</li>
                          <li>Lighting Correction</li>
                          <li>4K Upscaling</li>
                       </ul>
                    </div>
                </div>
            </div>

            {/* Results Section with Tabs */}
            <div className="lg:w-3/4">
                
                {/* Tabs */}
                <div className="flex items-center gap-2 mb-8 bg-slate-100/50 p-1.5 rounded-2xl w-full sm:w-fit overflow-x-auto">
                    <button
                        onClick={() => setActiveTab('studio')}
                        className={`px-4 py-2 rounded-xl text-xs font-bold transition-all flex items-center gap-2 whitespace-nowrap ${activeTab === 'studio' ? 'bg-white shadow-sm text-slate-900' : 'text-slate-500 hover:text-slate-700'}`}
                    >
                        <Box size={14} /> {product.productCategoryGroup === 'vehicle' ? 'Vehicle Shots' : product.productCategoryGroup === 'property' ? 'Property Shots' : 'Studio Shots'}
                    </button>
                    {hasModelShots && (
                        <button
                            onClick={() => setActiveTab('models')}
                            className={`px-4 py-2 rounded-xl text-xs font-bold transition-all flex items-center gap-2 whitespace-nowrap ${activeTab === 'models' ? 'bg-white shadow-sm text-slate-900' : 'text-slate-500 hover:text-slate-700'}`}
                        >
                            <User size={14} /> Models (Posed)
                        </button>
                    )}
                    {hasModelShots && (
                        <button
                            onClick={() => setActiveTab('interactive')}
                            className={`px-4 py-2 rounded-xl text-xs font-bold transition-all flex items-center gap-2 whitespace-nowrap ${activeTab === 'interactive' ? 'bg-white shadow-sm text-slate-900' : 'text-slate-500 hover:text-slate-700'}`}
                        >
                            <MousePointerClick size={14} /> Interactive Models
                        </button>
                    )}
                    <button
                        onClick={() => setActiveTab('video')}
                        className={`px-4 py-2 rounded-xl text-xs font-bold transition-all flex items-center gap-2 whitespace-nowrap ${activeTab === 'video' ? 'bg-white shadow-sm text-slate-900' : 'text-slate-500 hover:text-slate-700'}`}
                    >
                        <Video size={14} /> Ad Video
                    </button>
                </div>

                {/* Tab Content */}
                <div className="min-h-[400px]">

                    {/* Studio Tab -- shot list depends on product category, see services/taxonomy.ts */}
                    {activeTab === 'studio' && (
                        <div className="animate-fade-in">
                            <Product3DViewer
                                images={primaryShots
                                    .map((task) => ({ key: task.key, label: task.label, url: (product.results as any)[task.key] }))
                                    .filter((i): i is { key: string; label: string; url: string } => !!i.url)}
                                onViewImage={onViewImage}
                                onEdit={imageEditorEnabled ? (item) => setImageEditorTarget({ key: item.key, url: item.url, title: item.label }) : undefined}
                                isProcessing={product.status === 'processing'}
                            />
                        </div>
                    )}

                    {/* Models Posed Tab */}
                    {hasModelShots && activeTab === 'models' && (
                        <div className="grid grid-cols-2 gap-x-6 gap-y-10 animate-fade-in">
                             {renderResultImage(product.results.model_pose_classic, "Classic Editorial", "Dynamic Studio Style", "model_pose_classic", "model_pose_classic")}
                             {renderResultImage(product.results.model_pose_premium, "Futuristic Editorial", "High-Fashion Avant-Garde", "model_pose_premium", "model_pose_premium")}
                             <div className="col-span-2 flex items-center justify-center p-8 border border-dashed border-slate-200 rounded-2xl bg-slate-50/30 text-slate-400 text-xs">
                                Professional models selected based on product type
                             </div>
                        </div>
                    )}

                     {/* Interactive Models Tab */}
                     {hasModelShots && activeTab === 'interactive' && (
                        <div className="grid grid-cols-2 gap-x-6 gap-y-10 animate-fade-in">
                             {renderResultImage(product.results.model_interact_classic, "Classic Editorial", "Natural Interaction", "interact_classic", "model_interact_classic")}
                             {renderResultImage(product.results.model_interact_futuristic, "Futuristic Editorial", "Avant-Garde Style", "interact_futuristic", "model_interact_futuristic")}
                             <div className="col-span-2 flex items-center justify-center p-8 border border-dashed border-slate-200 rounded-2xl bg-slate-50/30 text-slate-400 text-xs">
                                Showing models interacting with product in distinct editorial styles
                             </div>
                        </div>
                    )}

                    {/* Video Tab - Updated with Two Options */}
                    {activeTab === 'video' && (
                        <div className="space-y-6 animate-fade-in">
                            {/* Video Settings Controls */}
                            <div className="bg-slate-50 rounded-xl p-6 border border-slate-100 space-y-6">
                                <div className="flex flex-wrap gap-6 items-center">
                                    <div className="flex items-center gap-3">
                                        <span className="text-xs font-bold text-slate-500 uppercase tracking-wider">Aspect Ratio</span>
                                        <div className="flex bg-white rounded-lg p-1 border border-slate-200">
                                            {(['9:16', '16:9', '1:1'] as const).map((ratio) => (
                                                <button
                                                    key={ratio}
                                                    onClick={() => setVideoSettings(prev => ({ ...prev, aspectRatio: ratio }))}
                                                    className={`px-3 py-1.5 rounded-md text-xs font-medium transition-all ${
                                                        videoSettings.aspectRatio === ratio
                                                            ? 'bg-rose-500 text-white shadow-sm'
                                                            : 'text-slate-500 hover:bg-slate-50'
                                                    }`}
                                                >
                                                    {ratio}
                                                </button>
                                            ))}
                                        </div>
                                    </div>

                                    <div className="flex items-center gap-3">
                                        <span className="text-xs font-bold text-slate-500 uppercase tracking-wider">Resolution</span>
                                        <div className="flex bg-white rounded-lg p-1 border border-slate-200">
                                            {(['720p', '1080p'] as const).map((res) => (
                                                <button
                                                    key={res}
                                                    onClick={() => setVideoSettings(prev => ({ ...prev, resolution: res }))}
                                                    className={`px-3 py-1.5 rounded-md text-xs font-medium transition-all ${
                                                        videoSettings.resolution === res
                                                            ? 'bg-rose-500 text-white shadow-sm'
                                                            : 'text-slate-500 hover:bg-slate-50'
                                                    }`}
                                                >
                                                    {res}
                                                </button>
                                            ))}
                                        </div>
                                    </div>
                                </div>

                                {/* Custom Video Prompt */}
                                <div className="space-y-2">
                                    <label className="text-xs font-bold text-slate-500 uppercase tracking-wider">Video Ad Prompt</label>
                                    <textarea 
                                        value={videoSettings.prompt}
                                        onChange={(e) => setVideoSettings(prev => ({ ...prev, prompt: e.target.value }))}
                                        className="w-full p-3 rounded-lg border border-slate-200 text-sm focus:outline-none focus:ring-2 focus:ring-rose-500/20"
                                        rows={2}
                                        placeholder="Describe the video movement, lighting, and vibe..."
                                    />
                                </div>

                                {/* Frame Selection */}
                                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                                    <div className="space-y-2">
                                        <label className="text-xs font-bold text-slate-500 uppercase tracking-wider">Start Frame (Required)</label>
                                        <div className="grid grid-cols-4 gap-2 max-h-40 overflow-y-auto p-2 bg-white rounded-lg border border-slate-200">
                                            {[
                                                { url: product.previewUrl, id: 'original' },
                                                ...Object.entries(product.results).map(([key, url]) => ({ url, id: key }))
                                            ].filter(item => item.url && !item.id.startsWith('video')).map((item) => (
                                                <div 
                                                    key={item.id}
                                                    onClick={() => setVideoSettings(prev => ({ ...prev, startImage: item.url }))}
                                                    className={`aspect-square rounded-md overflow-hidden cursor-pointer border-2 transition-all ${
                                                        videoSettings.startImage === item.url ? 'border-rose-500 ring-2 ring-rose-500/20' : 'border-transparent hover:border-slate-300'
                                                    }`}
                                                >
                                                    <img src={item.url} className="w-full h-full object-cover" alt={item.id} />
                                                </div>
                                            ))}
                                        </div>
                                    </div>

                                    <div className="space-y-2">
                                        <label className="text-xs font-bold text-slate-500 uppercase tracking-wider">End Frame (Optional)</label>
                                        <div className="grid grid-cols-4 gap-2 max-h-40 overflow-y-auto p-2 bg-white rounded-lg border border-slate-200">
                                            <div 
                                                onClick={() => setVideoSettings(prev => ({ ...prev, endImage: undefined }))}
                                                className={`aspect-square rounded-md overflow-hidden cursor-pointer border-2 flex items-center justify-center bg-slate-50 text-slate-400 text-[10px] text-center ${
                                                    !videoSettings.endImage ? 'border-rose-500 ring-2 ring-rose-500/20' : 'border-transparent hover:border-slate-300'
                                                }`}
                                            >
                                                None
                                            </div>
                                            {[
                                                { url: product.previewUrl, id: 'original' },
                                                ...Object.entries(product.results).map(([key, url]) => ({ url, id: key }))
                                            ].filter(item => item.url && !item.id.startsWith('video')).map((item) => (
                                                <div 
                                                    key={item.id}
                                                    onClick={() => setVideoSettings(prev => ({ ...prev, endImage: item.url }))}
                                                    className={`aspect-square rounded-md overflow-hidden cursor-pointer border-2 transition-all ${
                                                        videoSettings.endImage === item.url ? 'border-rose-500 ring-2 ring-rose-500/20' : 'border-transparent hover:border-slate-300'
                                                    }`}
                                                >
                                                    <img src={item.url} className="w-full h-full object-cover" alt={item.id} />
                                                </div>
                                            ))}
                                        </div>
                                    </div>
                                </div>
                                
                                <Button 
                                    onClick={() => {
                                        if (videoSettings.startImage) {
                                            onGenerateVideo(product, 'product', {
                                                aspectRatio: videoSettings.aspectRatio,
                                                resolution: videoSettings.resolution,
                                                startImage: videoSettings.startImage,
                                                endImage: videoSettings.endImage,
                                                prompt: videoSettings.prompt
                                            });
                                        }
                                    }} 
                                    variant="primary" 
                                    className="w-full shadow-lg shadow-rose-100"
                                    disabled={!videoSettings.startImage || product.videoProductStatus === 'generating'}
                                >
                                    <Sparkles size={14} className="mr-2" /> 
                                    {product.videoProductStatus === 'generating' ? 'Generating Video...' : 'Generate Custom Video'}
                                </Button>
                            </div>

                            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                                {renderVideoCard(
                                    'product',
                                    'Generated Video',
                                    'Your custom generated video advertisement.',
                                    product.results.video_product,
                                    product.videoProductStatus,
                                    product.videoError
                                )}
                            </div>
                        </div>
                    )}
                </div>
            </div>
        </div>

        {product.error && (
            <div className="mt-6 p-4 bg-red-50/50 border border-red-100 text-red-600 text-sm rounded-xl flex items-center animate-shake">
                <AlertCircle size={16} className="mr-2" />
                {product.error}
            </div>
        )}

      </div>

      {imageEditorTarget && (
          <React.Suspense fallback={<EditorLoadingOverlay />}>
              <ImageEditor
                  isOpen={!!imageEditorTarget}
                  imageUrl={imageEditorTarget.url}
                  title={imageEditorTarget.title}
                  onClose={() => setImageEditorTarget(null)}
                  onSave={(dataUrl) => onSaveEdit(product.id, imageEditorTarget.key, dataUrl)}
              />
          </React.Suspense>
      )}

      {videoEditorTarget && (
          <React.Suspense fallback={<EditorLoadingOverlay />}>
              <VideoEditor
                  isOpen={!!videoEditorTarget}
                  videoUrl={videoEditorTarget.url}
                  title={videoEditorTarget.title}
                  onClose={() => setVideoEditorTarget(null)}
                  onSave={(blobUrl) => onSaveEdit(product.id, videoEditorTarget.key, blobUrl)}
              />
          </React.Suspense>
      )}

      {capCutToast && (
          <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-[200] max-w-sm px-4 py-3 rounded-xl bg-slate-900 text-white text-xs shadow-2xl shadow-black/30 flex items-start gap-2.5 animate-fade-in-up">
              <Film size={15} className="mt-0.5 shrink-0 text-cyan-300" />
              <span>{capCutToast}</span>
          </div>
      )}
      {upscaleError && (
          <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-[200] max-w-sm px-4 py-3 rounded-xl bg-slate-900 text-white text-xs shadow-2xl shadow-black/30 flex items-start gap-2.5 animate-fade-in-up">
              <AlertCircle size={15} className="mt-0.5 shrink-0 text-red-400" />
              <span>{upscaleError}</span>
              <button onClick={() => setUpscaleError(null)} className="ml-auto text-white/50 hover:text-white shrink-0">×</button>
          </div>
      )}
    </div>
  );
};