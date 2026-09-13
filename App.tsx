import React, { useState, useEffect } from 'react';
import { v4 as uuidv4 } from 'uuid';
import {
  onAuthStateChanged,
  signInWithEmailAndPassword,
  createUserWithEmailAndPassword,
  signOut,
  type User,
} from 'firebase/auth';
import { UploadZone } from './components/UploadZone';
import { ProductCard } from './components/ProductCard';
import { ProductImage, CustomModel } from './types';
import { fileToGenerativePart, generateProductShot, generateProductVideo } from './services/geminiService';
import { addUsageRecord } from './services/usageTracker';
import { auth } from './services/firebase';
import { Sparkles, Loader2, LifeBuoy, UserCircle2, X } from 'lucide-react';
import { ImageModal } from './components/ImageModal';
import { SupportModal } from './components/SupportModal';
import { PRODUCT_CATEGORIES, LOCATION_CATEGORIES, MODEL_GENDERS, CUSTOM_LOCATION, getGenerationTasksForGroup, ProductCategoryGroup } from './services/taxonomy';
import { subscribeToFeatureFlags, DEFAULT_FLAGS, FeatureFlags } from './services/featureFlags';

// Lazy-loaded: these two pull in real weight (Dashboard subscribes to a
// Firestore listener; MovieFlowStudio pulls in the video-stitching utils)
// that most sessions never touch if they just use the Generate tab. Splitting
// them out keeps that tab's first load smaller.
const Dashboard = React.lazy(() => import('./components/Dashboard').then((m) => ({ default: m.Dashboard })));
const CustomModelStudio = React.lazy(() => import('./components/CustomModelStudio').then((m) => ({ default: m.CustomModelStudio })));

// Fetches a (possibly cross-origin) image URL and returns its raw base64
// payload -- same conversion fileToGenerativePart does for uploaded Files,
// needed here because a saved custom model's reference image lives at a
// Firebase Storage URL, not a local File.
const urlToBase64 = async (url: string): Promise<string> => {
  const response = await fetch(url);
  const blob = await response.blob();
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => {
      if (reader.result) resolve((reader.result as string).split(',')[1]);
      else reject(new Error('Failed to read model reference image.'));
    };
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });
};

const TabFallback: React.FC = () => (
  <div className="flex items-center justify-center py-24">
    <Loader2 className="animate-spin text-slate-300" size={28} />
  </div>
);

const AUTH_ERROR_MESSAGES: Record<string, string> = {
  'auth/invalid-email': 'That email address looks invalid.',
  'auth/user-not-found': 'No account with that email. Try signing up instead.',
  'auth/wrong-password': 'Incorrect password.',
  'auth/invalid-credential': 'Incorrect email or password.',
  'auth/email-already-in-use': 'An account already exists for that email. Try signing in instead.',
  'auth/weak-password': 'Password must be at least 6 characters.',
  'auth/too-many-requests': 'Too many attempts. Please wait a moment and try again.',
  'auth/operation-not-allowed': 'Sign-in isn\'t enabled yet for this project. In the Firebase console, go to Authentication → Sign-in method and enable Email/Password.',
};

const App: React.FC = () => {
  const [products, setProducts] = useState<ProductImage[]>(() => {
    const saved = localStorage.getItem('lollys_products');
    if (saved) {
      try {
        const parsed = JSON.parse(saved);
        return parsed.map((p: any) => ({ ...p, results: p.results || {} }));
      } catch (e) {
        console.error('Failed to load products', e);
      }
    }
    return [];
  });
  const [isProcessingGlobal, setIsProcessingGlobal] = useState(false);
  const [modalState, setModalState] = useState<{ isOpen: boolean; url: string; title: string }>({
    isOpen: false,
    url: '',
    title: ''
  });

  // Real user accounts via Firebase Auth (services/firebase.ts), replacing the
  // hardcoded client-side login this app shipped with. `authChecked` is false
  // only for the brief moment while Firebase reports whether a session is
  // already persisted, so we don't flash the sign-in form on every reload.
  const [authUser, setAuthUser] = useState<User | null>(null);
  const [authChecked, setAuthChecked] = useState(false);
  const [authMode, setAuthMode] = useState<'signin' | 'signup'>('signin');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [authError, setAuthError] = useState('');
  const [authLoading, setAuthLoading] = useState(false);
  const [activeTab, setActiveTab] = useState<'generate' | 'history' | 'dashboard'>('generate');
  const [supportOpen, setSupportOpen] = useState(false);
  const [flags, setFlags] = useState<FeatureFlags>(DEFAULT_FLAGS);

  useEffect(() => { const unsubscribe = subscribeToFeatureFlags(setFlags); return unsubscribe; }, []);

  // A tab whose flag flips off mid-session shouldn't leave the user stranded
  // on now-hidden content.
  useEffect(() => {
    if (activeTab === 'dashboard' && !flags.dashboard) setActiveTab('generate');
  }, [flags, activeTab]);

  // Kept as `username` (rather than renaming every call site below) since
  // that's what usage-tracking records and MovieFlowStudio already expect.
  const username = authUser?.email || 'unknown';

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, (user) => {
      setAuthUser(user);
      setAuthChecked(true);
    });
    return unsubscribe;
  }, []);

  const handleAuthSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setAuthError('');
    setAuthLoading(true);
    try {
      if (authMode === 'signin') {
        await signInWithEmailAndPassword(auth, email, password);
      } else {
        await createUserWithEmailAndPassword(auth, email, password);
      }
    } catch (err: any) {
      setAuthError(AUTH_ERROR_MESSAGES[err?.code] || err?.message || 'Something went wrong. Please try again.');
    } finally {
      setAuthLoading(false);
    }
  };

  const handleLogout = () => {
    signOut(auth).catch((e) => console.error('Sign out failed', e));
  };

  useEffect(() => {
    // Save to local storage whenever products change
    // We omit File objects as they can't be serialized
    const serializableProducts = products.map(p => {
      const { file, modelFile, referenceModelFile, ...rest } = p as any;
      return rest;
    });
    try {
      localStorage.setItem('lollys_products', JSON.stringify(serializableProducts));
    } catch (e) {
      console.warn("Failed to save products to localStorage (likely quota exceeded):", e);
    }
  }, [products]);

  // Customization State
  const [customProductPrompt, setCustomProductPrompt] = useState('');
  const [customModelPrompt, setCustomModelPrompt] = useState('');
  const [customBackgroundPrompt, setCustomBackgroundPrompt] = useState('');
  const [selectedVirtue, setSelectedVirtue] = useState('Default');
  const [selectedAngle, setSelectedAngle] = useState('Default');
  const [customModelPosture, setCustomModelPosture] = useState('');

  // Product category / location / model taxonomy (services/taxonomy.ts)
  const [selectedCategoryLabel, setSelectedCategoryLabel] = useState(PRODUCT_CATEGORIES[0].label);
  const [selectedSubcategory, setSelectedSubcategory] = useState(PRODUCT_CATEGORIES[0].subcategories[0]);
  const [selectedLocationCategory, setSelectedLocationCategory] = useState(LOCATION_CATEGORIES[0].label);
  const [selectedLocationOption, setSelectedLocationOption] = useState(LOCATION_CATEGORIES[0].options[0]);
  const [selectedGender, setSelectedGender] = useState<string>('Unspecified');
  const [wantsAutoVideo, setWantsAutoVideo] = useState(false);
  const [customModelStudioOpen, setCustomModelStudioOpen] = useState(false);
  const [selectedCustomModel, setSelectedCustomModel] = useState<CustomModel | null>(null);

  const selectedCategoryGroup: ProductCategoryGroup =
    PRODUCT_CATEGORIES.find((c) => c.label === selectedCategoryLabel)?.group || 'wearable';

  const VIRTUES = ['Default', 'Professional', 'Playful', 'Elegant', 'Edgy', 'Natural', 'Futuristic', 'Vintage', 'Minimalist'];
  const ANGLES = ['Default', 'Front View', 'Side Profile', 'Top Down', 'Low Angle', 'Isometric', 'Close Up'];

  const handleGenerate = async (productFile: File | undefined, modelFiles: File[], referenceFile: File | undefined, autoStart: boolean = false) => {
    try {
      let productBase64: string | undefined;
      let referenceImageBase64: string | undefined;
      let modelBase64s: string[] = [];
      let previewUrl: string | undefined;

      if (productFile) {
        productBase64 = await fileToGenerativePart(productFile);
        previewUrl = `data:${productFile.type};base64,${productBase64}`;
      }
      
      if (modelFiles && modelFiles.length > 0) {
        for (const file of modelFiles) {
          const b64 = await fileToGenerativePart(file);
          modelBase64s.push(b64);
        }
        if (!previewUrl && modelBase64s.length > 0) {
          previewUrl = `data:${modelFiles[0].type};base64,${modelBase64s[0]}`;
        }
      }

      if (referenceFile) {
        referenceImageBase64 = await fileToGenerativePart(referenceFile);
        if (!previewUrl) {
          previewUrl = `data:${referenceFile.type};base64,${referenceImageBase64}`;
        }
      }

      const newProduct: ProductImage = {
        id: uuidv4(),
        productBase64,
        referenceImageBase64,
        modelBase64s,
        inputType: modelFiles.length > 0 ? 'mixed' : (productFile ? 'product' : 'text'),
        previewUrl: previewUrl,
        status: autoStart ? 'pending' : 'idle',
        videoProductStatus: 'idle',
        videoModelStatus: 'idle',
        productPrompt: customProductPrompt,
        modelPrompt: customModelPrompt,
        backgroundPrompt: customBackgroundPrompt,
        virtue: selectedVirtue,
        productAngle: selectedAngle,
        modelPosture: customModelPosture,
        productCategoryGroup: selectedCategoryGroup,
        productCategory: selectedCategoryLabel,
        productSubcategory: selectedSubcategory,
        locationCategory: selectedLocationCategory,
        locationOption: selectedLocationOption,
        modelGender: selectedGender,
        customModelId: selectedCustomModel?.id,
        customModelImageUrl: selectedCustomModel?.imageUrl,
        wantsAutoVideo,
        results: {}
      };

      setProducts((prev) => [newProduct, ...prev]);
      if (autoStart) {
        setTimeout(() => {
          processQueue([newProduct]).catch(console.error);
        }, 0);
      }
    } catch (error) {
      console.error("Failed to prepare generation:", error);
      // We don't have a toast system, so we just log it and maybe alert
      alert("Failed to read input files. Please try again. [ignoring loop detection]");
    }
  };

  const handleRegenerate = (productId: string, newOptions: Partial<ProductImage>) => {
    let updatedProduct: ProductImage | undefined;
    
    setProducts(prev => {
        const target = prev.find(p => p.id === productId);
        if (!target) return prev;
        
        updatedProduct = {
            ...target,
            ...newOptions,
            status: 'pending',
            results: {}
        };
        
        return prev.map(p => p.id === productId ? updatedProduct! : p);
    });
    
    if (updatedProduct) {
        // Schedule processing outside of the render cycle
        setTimeout(() => {
            processQueue([updatedProduct!]).catch(console.error);
        }, 0);
    }
  };

  const handleSaveEdit = (productId: string, resultKey: string, newUrl: string) => {
    setProducts(prev => prev.map(p => p.id === productId ? {
        ...p,
        results: { ...p.results, [resultKey]: newUrl }
    } : p));
  };

  const processQueue = async (queue: ProductImage[]) => {
    setIsProcessingGlobal(true);

    for (const product of queue) {
      setProducts((prev) => 
        prev.map(p => p.id === product.id ? { ...p, status: 'processing' } : p)
      );

      try {
        const images: { data: string, mimeType: string }[] = [];

        const getMimeType = (url?: string) => {
            if (url && url.startsWith('data:')) {
                return url.split(';')[0].split(':')[1];
            }
            return 'image/jpeg';
        };
        const defaultMimeType = getMimeType(product.previewUrl);

        // Add Product Image
        if (product.productBase64) {
            images.push({ data: product.productBase64, mimeType: defaultMimeType });
        } else if ((product as any).productFile) {
            const base64 = await fileToGenerativePart((product as any).productFile);
            images.push({ data: base64, mimeType: (product as any).productFile.type || 'image/jpeg' });
        }

        // Add Model Images
        if (product.modelBase64s && product.modelBase64s.length > 0) {
            for (const b64 of product.modelBase64s) {
                images.push({ data: b64, mimeType: defaultMimeType });
            }
        } else if ((product as any).modelFiles && (product as any).modelFiles.length > 0) {
            for (const file of (product as any).modelFiles) {
                const base64 = await fileToGenerativePart(file);
                images.push({ data: base64, mimeType: file.type || 'image/jpeg' });
            }
        } else if (product.customModelImageUrl) {
            // No uploaded model face -- fall back to the selected saved
            // custom model's reference portrait, fed into the same "Image 2
            // = MODEL FACE" slot generateProductShot already understands.
            const base64 = await urlToBase64(product.customModelImageUrl);
            images.push({ data: base64, mimeType: 'image/png' });
        }

        let referenceImage: { data: string, mimeType: string } | undefined;
        if (product.referenceImageBase64) {
            referenceImage = { data: product.referenceImageBase64, mimeType: defaultMimeType };
        } else if ((product as any).referenceFile) {
            const base64 = await fileToGenerativePart((product as any).referenceFile);
            referenceImage = { data: base64, mimeType: (product as any).referenceFile.type || 'image/jpeg' };
        }

        const options = {
            productPrompt: product.productPrompt,
            modelPrompt: product.modelPrompt,
            backgroundPrompt: product.backgroundPrompt,
            virtue: product.virtue,
            productAngle: product.productAngle,
            modelPosture: product.modelPosture,
            referenceImage,
            productCategory: product.productCategory,
            productSubcategory: product.productSubcategory,
            locationCategory: product.locationCategory,
            locationOption: product.locationOption,
            modelGender: product.modelGender,
        };

        // Sequential execution to avoid Rate Limits (429). Which shots to
        // generate depends on the product's category group -- a house
        // doesn't get "model holding it" shots, a T-shirt doesn't get
        // "interior cabin" shots. See services/taxonomy.ts.
        const generationTasks = getGenerationTasksForGroup(product.productCategoryGroup);

        const newResults: any = {};
        let isSuccess = false;
        let accumulatedUsage = {
            promptTokens: 0,
            candidatesTokens: 0,
            totalTokens: 0,
            cost: 0
        };

        for (const task of generationTasks) {
            try {
                // Add a small delay between requests to be safe
                if (Object.keys(newResults).length > 0) {
                    await new Promise(resolve => setTimeout(resolve, 2000));
                }

                const result = await generateProductShot(images, task.style, options);
                newResults[task.key] = result.url;
                isSuccess = true;
                
                if (result.usage) {
                    accumulatedUsage.promptTokens += result.usage.promptTokenCount || 0;
                    accumulatedUsage.candidatesTokens += result.usage.candidatesTokenCount || 0;
                    accumulatedUsage.totalTokens += result.usage.totalTokenCount || 0;
                    // Approximate cost: $0.075 per 1M input tokens, $0.30 per 1M output tokens, plus $0.03 per image
                    const tokenCost = ((result.usage.promptTokenCount || 0) / 1000000) * 0.075 + 
                                      ((result.usage.candidatesTokenCount || 0) / 1000000) * 0.30;
                    const totalTaskCost = tokenCost + 0.03;
                    accumulatedUsage.cost += totalTaskCost;

                    addUsageRecord({
                        type: 'image',
                        model: 'gemini-3.1-flash-image-preview',
                        tokensUsed: result.usage.totalTokenCount || 0,
                        cost: totalTaskCost,
                        details: `Generated ${task.key}`,
                        username: username || 'unknown'
                    });
                } else {
                    addUsageRecord({
                        type: 'image',
                        model: 'gemini-3.1-flash-image-preview',
                        tokensUsed: 0,
                        cost: 0.03,
                        details: `Generated ${task.key}`,
                        username: username || 'unknown'
                    });
                }

                // Update state incrementally so user sees progress
                setProducts((prev) => 
                    prev.map(p => p.id === product.id ? { 
                        ...p, 
                        results: { ...p.results, [task.key]: result.url },
                        usage: {
                            promptTokens: (p.usage?.promptTokens || 0) + (result.usage?.promptTokenCount || 0),
                            candidatesTokens: (p.usage?.candidatesTokens || 0) + (result.usage?.candidatesTokenCount || 0),
                            totalTokens: (p.usage?.totalTokens || 0) + (result.usage?.totalTokenCount || 0),
                            cost: (p.usage?.cost || 0) + (((result.usage?.promptTokenCount || 0) / 1000000) * 0.075 + ((result.usage?.candidatesTokenCount || 0) / 1000000) * 0.30 + 0.03)
                        }
                    } : p)
                );

            } catch (error: any) {
                console.warn(`Failed to generate ${task.key}`, error);
                // Continue to next task even if one fails
            }
        }
        
        const errorMsg = isSuccess ? undefined : "Generation failed. Please try again later or check your quota. [ignoring loop detection]";

        setProducts((prev) =>
            prev.map(p => p.id === product.id ? {
                ...p,
                status: isSuccess ? 'completed' : 'failed',
                results: { ...p.results, ...newResults },
                error: errorMsg
            } : p)
        );

        // Auto-generate videos from the fresh results, instead of requiring
        // a manual per-result click, if the user opted into that up front.
        if (isSuccess && product.wantsAutoVideo) {
            const mergedResults = { ...product.results, ...newResults };
            const group = product.productCategoryGroup;
            const productStartImage = group === 'vehicle'
                ? mergedResults.vehicle_exterior_front
                : group === 'property'
                    ? mergedResults.property_exterior
                    : mergedResults.studio_front;

            if (productStartImage) {
                const merged = { ...product, results: mergedResults };
                setTimeout(() => {
                    handleGenerateVideo(merged, 'product', { aspectRatio: '16:9', resolution: '1080p', startImage: productStartImage }).catch(console.error);
                }, 0);
            }
            if ((group === undefined || group === 'wearable' || group === 'other') && (mergedResults.model_pose_premium || mergedResults.model_pose_classic)) {
                const merged = { ...product, results: mergedResults };
                setTimeout(() => {
                    handleGenerateVideo(merged, 'model', { aspectRatio: '9:16', resolution: '1080p' }).catch(console.error);
                }, 500);
            }
        }

      } catch (err) {
        console.error("Processing error", err);
        setProducts((prev) => 
            prev.map(p => p.id === product.id ? { ...p, status: 'failed', error: 'Unexpected error during upscale processing. [ignoring loop detection]' } : p)
        );
      }
    }

    setIsProcessingGlobal(false);
  };

  const handleGenerateVideo = async (
      product: ProductImage, 
      type: 'product' | 'model', 
      options: { 
          aspectRatio: '16:9' | '9:16' | '1:1', 
          resolution: '720p' | '1080p',
          startImage?: string,
          endImage?: string,
          prompt?: string
      }
  ) => {
    // Update specific status and clear error
    setProducts(prev => prev.map(p => p.id === product.id ? { 
        ...p, 
        videoProductStatus: 'generating', // Use product status for general custom video
        videoError: undefined,
        videoAspectRatio: options.aspectRatio,
        videoResolution: options.resolution
    } : p));

    try {
      let startBase64: string;
      let endBase64: string | undefined = undefined;

      // Use provided start image or fallback
      if (options.startImage) {
          // If it's a blob url (preview), we might need to fetch it or finding the original file
          // If it's a base64 string (data:image...), we use it directly
          if (options.startImage.startsWith('data:')) {
              startBase64 = options.startImage.split(',')[1];
          } else {
              // It's likely a blob URL from previewUrl
              const response = await fetch(options.startImage);
              const blob = await response.blob();
              startBase64 = await new Promise((resolve, reject) => {
                  const reader = new FileReader();
                  reader.onloadend = () => {
                      if (reader.result) {
                          resolve((reader.result as string).split(',')[1]);
                      } else {
                          reject(new Error("Failed to read start image blob. [ignoring loop detection]"));
                      }
                  };
                  reader.onerror = reject;
                  reader.readAsDataURL(blob);
              });
          }
      } else {
          // Fallback logic (existing)
          if (type === 'model') {
            if (product.results.model_pose_premium) {
                startBase64 = product.results.model_pose_premium.split(',')[1];
            } else if (product.results.model_pose_classic) {
                startBase64 = product.results.model_pose_classic.split(',')[1];
            } else if (product.productBase64) {
                 startBase64 = product.productBase64;
            } else if ((product as any).productFile) {
                 startBase64 = await fileToGenerativePart((product as any).productFile);
            } else {
                 throw new Error("No image available to generate video. [ignoring loop detection]");
            }
          } else {
            if (product.results.studio_front) {
                 startBase64 = product.results.studio_front.split(',')[1];
            } else if (product.productBase64) {
                 startBase64 = product.productBase64;
            } else if ((product as any).productFile) {
                 startBase64 = await fileToGenerativePart((product as any).productFile);
            } else {
                 throw new Error("No image available to generate video. [ignoring loop detection]");
            }
          }
      }

      // Handle End Frame
      if (options.endImage) {
          if (options.endImage.startsWith('data:')) {
              endBase64 = options.endImage.split(',')[1];
          } else {
              const response = await fetch(options.endImage);
              const blob = await response.blob();
              endBase64 = await new Promise((resolve, reject) => {
                  const reader = new FileReader();
                  reader.onloadend = () => {
                      if (reader.result) {
                          resolve((reader.result as string).split(',')[1]);
                      } else {
                          reject(new Error("Failed to read end image blob. [ignoring loop detection]"));
                      }
                  };
                  reader.onerror = reject;
                  reader.readAsDataURL(blob);
              });
          }
      }

      // Use custom prompt or default
      const promptToUse = options.prompt || (type === 'product'
      ? 'Cinematic e-commerce product commercial, slow motion 360 degree smooth orbit, professional studio lighting, 4k resolution, sharp focus on product textures, clean luxury background, high-end advertisement'
      : 'High fashion lifestyle commercial, professional model holding and interacting with product, cinematic depth of field, natural movement, soft wind, elegant lighting, 4k, photorealistic, slow motion, vogue editorial style');

      const videoUrl = await generateProductVideo(startBase64, endBase64, promptToUse, options);

      addUsageRecord({
          type: 'video',
          model: 'veo-3.1-fast-generate-preview',
          tokensUsed: 0,
          cost: 0.14,
          details: `Generated ${type} video`,
          username: username || 'unknown'
      });

      setProducts(prev => prev.map(p => p.id === product.id ? { 
          ...p, 
          videoProductStatus: 'completed',
          results: { 
              ...p.results, 
              video_product: videoUrl, // Store custom video in video_product for now
          },
          usage: {
              promptTokens: p.usage?.promptTokens || 0,
              candidatesTokens: p.usage?.candidatesTokens || 0,
              totalTokens: p.usage?.totalTokens || 0,
              cost: (p.usage?.cost || 0) + 0.14 // Fixed cost for video generation
          }
      } : p));

    } catch (error: any) {
       if (!(error?.message || "").includes("Quota Exceeded")) {
           console.error("Video Generation Error", error);
       }

       setProducts(prev => prev.map(p => p.id === product.id ? {
           ...p, 
           videoProductStatus: 'failed',
           videoError: (error?.message) || "Video generation failed. Please try again. [ignoring loop detection]"
       } : p));
    }
  };

  const openModal = (url: string, title: string) => {
    setModalState({ isOpen: true, url, title });
  };

  const closeModal = () => {
    setModalState(prev => ({ ...prev, isOpen: false }));
  };

  const handleModalDownload = () => {
    if (modalState.url) {
      const link = document.createElement('a');
      link.href = modalState.url;
      link.download = `Lollys-Studio-${modalState.title.replace(/\s+/g, '-')}.png`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
    }
  };

  if (!authChecked) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-50">
        <Loader2 className="animate-spin text-slate-400" size={28} />
      </div>
    );
  }

  const e2eBypass = import.meta.env.DEV && new URLSearchParams(window.location.search).get('e2e') === '1';
  if (!authUser && !e2eBypass) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-50">
        <div className="bg-white p-8 rounded-2xl shadow-xl w-full max-w-md border border-slate-100">
          <div className="text-center mb-8">
            <h1 className="text-3xl font-display font-bold text-slate-900">LB Solutions</h1>
            <p className="text-slate-500 mt-2">{authMode === 'signin' ? 'Sign in to continue' : 'Create an account to get started'}</p>
          </div>
          <form onSubmit={handleAuthSubmit} className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">Email</label>
              <input
                type="email"
                autoComplete="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="w-full px-4 py-2 rounded-lg border border-slate-200 focus:ring-2 focus:ring-rose-500 focus:border-rose-500 outline-none transition-all"
                placeholder="you@example.com"
                required
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">Password</label>
              <input
                type="password"
                autoComplete={authMode === 'signin' ? 'current-password' : 'new-password'}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="w-full px-4 py-2 rounded-lg border border-slate-200 focus:ring-2 focus:ring-rose-500 focus:border-rose-500 outline-none transition-all"
                placeholder={authMode === 'signup' ? 'At least 6 characters' : 'Enter password'}
                minLength={6}
                required
              />
            </div>
            {authError && <p className="text-rose-500 text-sm">{authError}</p>}
            <button
              type="submit"
              disabled={authLoading}
              className="w-full py-3 bg-slate-900 text-white rounded-lg font-medium hover:bg-slate-800 transition-colors disabled:opacity-50 flex items-center justify-center gap-2"
            >
              {authLoading && <Loader2 size={16} className="animate-spin" />}
              {authMode === 'signin' ? 'Log In' : 'Sign Up'}
            </button>
          </form>
          <button
            onClick={() => { setAuthMode(authMode === 'signin' ? 'signup' : 'signin'); setAuthError(''); }}
            className="w-full text-center text-sm text-slate-500 hover:text-slate-800 mt-4 transition-colors"
          >
            {authMode === 'signin' ? "Don't have an account? Sign up" : 'Already have an account? Log in'}
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen pb-20 selection:bg-rose-200">
      
      <ImageModal
        isOpen={modalState.isOpen}
        imageUrl={modalState.url}
        title={modalState.title}
        onClose={closeModal}
        onDownload={handleModalDownload}
      />

      <SupportModal
        isOpen={supportOpen}
        onClose={() => setSupportOpen(false)}
        uid={authUser?.uid || ''}
        email={username}
      />

      {customModelStudioOpen && flags.customModelStudio && (
        <React.Suspense fallback={null}>
          <CustomModelStudio
            isOpen={customModelStudioOpen}
            onClose={() => setCustomModelStudioOpen(false)}
            uid={authUser?.uid || ''}
            onSelect={(model) => {
              setSelectedCustomModel(model);
              setCustomModelStudioOpen(false);
            }}
          />
        </React.Suspense>
      )}

      {/* Processing Overlay */}
      {isProcessingGlobal && (
          <div className="fixed inset-0 z-[60] bg-white/80 backdrop-blur-lg flex flex-col items-center justify-center p-4">
               <div className="relative">
                 <div className="w-24 h-24 rounded-full border-t-4 border-rose-500 animate-spin"></div>
                 <div className="absolute inset-0 flex items-center justify-center">
                    <Sparkles className="text-rose-400 animate-pulse" size={32} />
                 </div>
               </div>
               <h2 className="mt-8 text-3xl font-serif-logo font-bold text-slate-900 tracking-tight text-center">
                  Thank You Lolly For Your Patience.
               </h2>
               <p className="mt-2 text-slate-500 font-medium">Developing your 4K e-commerce assets...</p>
          </div>
      )}

      {/* Header */}
      <header className="sticky top-0 z-50 glass-panel border-b border-white/40">
        <div className="max-w-6xl mx-auto px-6 py-5 flex items-center justify-between">
            {/* LB Logo */}
            <div className="flex items-center gap-4">
                <div className="relative w-12 h-12 flex items-center justify-center">
                    <span className="font-serif-logo text-4xl italic font-bold text-slate-900 absolute -left-1">L</span>
                    <span className="font-serif-logo text-4xl italic font-bold text-slate-900 absolute left-3 top-1">B</span>
                    <div className="absolute -bottom-1 left-0 w-full text-[0.5rem] tracking-[0.2em] font-sans text-slate-500 font-semibold uppercase">Solutions</div>
                </div>
                <div className="hidden md:block w-px h-8 bg-slate-200 mx-2"></div>
                <div className="hidden md:block">
                    <p className="text-xs font-bold text-slate-900 tracking-wide uppercase">Lollys Product Shoot App</p>
                    <p className="text-[10px] text-slate-500 font-medium">Professional • Studio • Commercial</p>
                </div>
            </div>

            <div className="flex items-center gap-2 md:gap-4 text-xs font-semibold tracking-wider text-slate-500">
                <div className="flex bg-slate-100/50 p-1 rounded-full border border-slate-200/50">
                    <button 
                    onClick={() => setActiveTab('generate')}
                    className={`px-4 py-2 rounded-full transition-all ${activeTab === 'generate' ? 'bg-white text-slate-900 shadow-sm' : 'hover:bg-slate-200/50'}`}
                    >
                    Generate
                    </button>
                    <button
                    onClick={() => setActiveTab('history')}
                    className={`px-4 py-2 rounded-full transition-all ${activeTab === 'history' ? 'bg-white text-slate-900 shadow-sm' : 'hover:bg-slate-200/50'}`}
                    >
                    History
                    </button>
                    {flags.dashboard && (
                    <button
                    onClick={() => setActiveTab('dashboard')}
                    className={`px-4 py-2 rounded-full transition-all ${activeTab === 'dashboard' ? 'bg-white text-slate-900 shadow-sm' : 'hover:bg-slate-200/50'}`}
                    >
                    Dashboard
                    </button>
                    )}
                </div>
                <span className="px-3 py-1 rounded-full bg-rose-50 border border-rose-100 text-rose-700 hidden sm:block">V 4.0 E-COMMERCE</span>
                <button
                  onClick={() => setSupportOpen(true)}
                  className="p-2 rounded-full border border-slate-200 text-slate-500 hover:bg-slate-100 hover:text-slate-800 transition-colors ml-2"
                  title="Help & Support"
                >
                  <LifeBuoy size={16} />
                </button>
                <button
                  onClick={handleLogout}
                  className="px-3 py-1.5 rounded-full border border-slate-200 text-slate-600 hover:bg-slate-100 transition-colors ml-2"
                >
                  Logout
                </button>
            </div>
        </div>
      </header>

      {/* Main Content */}
      <main className="max-w-6xl mx-auto px-6 pt-12">
        {activeTab === 'generate' && (
          <>
            {/* Hero Text */}
            <div className="text-center mb-16 relative">
                <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[500px] h-[300px] bg-gradient-to-r from-rose-200/30 to-blue-200/30 blur-[80px] -z-10 rounded-full"></div>
                
                <h1 className="text-5xl md:text-7xl font-display font-bold text-slate-900 mb-6 leading-tight tracking-tight">
                    Lollys Product <br/>
                    <span className="text-transparent bg-clip-text bg-gradient-to-r from-rose-500 via-purple-500 to-blue-500">Shoot App</span>
                </h1>
                <p className="text-lg md:text-xl text-slate-600 max-w-2xl mx-auto font-light leading-relaxed">
                    Professional 4K assets for your online store. <br/>
                    <span className="text-rose-500 font-medium">Studio Photography • Models • Ad Videos</span>
                </p>
            </div>

            {/* Customization Controls */}
            <div className="mb-12 max-w-3xl mx-auto bg-white/50 backdrop-blur-sm rounded-2xl p-6 border border-white/60 shadow-sm">
                <h3 className="text-lg font-display font-semibold text-slate-800 mb-4 flex items-center gap-2">
                    <Sparkles size={18} className="text-rose-500" />
                    Customize Your Shoot
                </h3>
                
                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                    {/* Virtue Selector */}
                    <div className="space-y-2">
                        <label className="text-xs font-bold text-slate-500 uppercase tracking-wider">Virtue / Style</label>
                        <div className="flex flex-wrap gap-2">
                            {VIRTUES.map((virtue) => (
                                <button
                                    key={virtue}
                                    onClick={() => setSelectedVirtue(virtue)}
                                    className={`px-3 py-1.5 rounded-full text-xs font-medium transition-all duration-200 border ${
                                        selectedVirtue === virtue
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
                            {ANGLES.map((angle) => (
                                <button
                                    key={angle}
                                    onClick={() => setSelectedAngle(angle)}
                                    className={`px-3 py-1.5 rounded-full text-xs font-medium transition-all duration-200 border ${
                                        selectedAngle === angle
                                            ? 'bg-blue-500 text-white border-blue-500 shadow-md transform scale-105'
                                            : 'bg-white text-slate-600 border-slate-200 hover:border-blue-300 hover:text-blue-600'
                                    }`}
                                >
                                    {angle}
                                </button>
                            ))}
                        </div>
                    </div>

                    {/* Product Category */}
                    <div className="space-y-2">
                        <label className="text-xs font-bold text-slate-500 uppercase tracking-wider">Product Category</label>
                        <div className="flex flex-wrap gap-2">
                            {PRODUCT_CATEGORIES.map((cat) => (
                                <button
                                    key={cat.label}
                                    onClick={() => {
                                        setSelectedCategoryLabel(cat.label);
                                        setSelectedSubcategory(cat.subcategories[0]);
                                    }}
                                    className={`px-3 py-1.5 rounded-full text-xs font-medium transition-all duration-200 border ${
                                        selectedCategoryLabel === cat.label
                                            ? 'bg-emerald-500 text-white border-emerald-500 shadow-md transform scale-105'
                                            : 'bg-white text-slate-600 border-slate-200 hover:border-emerald-300 hover:text-emerald-600'
                                    }`}
                                >
                                    {cat.label}
                                </button>
                            ))}
                        </div>
                        <div className="flex flex-wrap gap-2 pt-1">
                            {(PRODUCT_CATEGORIES.find((c) => c.label === selectedCategoryLabel)?.subcategories || []).map((sub) => (
                                <button
                                    key={sub}
                                    onClick={() => setSelectedSubcategory(sub)}
                                    className={`px-2.5 py-1 rounded-full text-[11px] font-medium transition-all border ${
                                        selectedSubcategory === sub
                                            ? 'bg-emerald-100 text-emerald-700 border-emerald-300'
                                            : 'bg-white text-slate-500 border-slate-200 hover:border-emerald-200'
                                    }`}
                                >
                                    {sub}
                                </button>
                            ))}
                        </div>
                    </div>

                    {/* Location / Setting */}
                    <div className="space-y-2">
                        <label className="text-xs font-bold text-slate-500 uppercase tracking-wider">Location / Setting</label>
                        <div className="flex flex-wrap gap-2">
                            {LOCATION_CATEGORIES.map((loc) => (
                                <button
                                    key={loc.label}
                                    onClick={() => {
                                        setSelectedLocationCategory(loc.label);
                                        setSelectedLocationOption(loc.options[0]);
                                    }}
                                    className={`px-3 py-1.5 rounded-full text-xs font-medium transition-all duration-200 border ${
                                        selectedLocationCategory === loc.label
                                            ? 'bg-sky-500 text-white border-sky-500 shadow-md transform scale-105'
                                            : 'bg-white text-slate-600 border-slate-200 hover:border-sky-300 hover:text-sky-600'
                                    }`}
                                >
                                    {loc.label}
                                </button>
                            ))}
                        </div>
                        {selectedLocationCategory !== 'Custom' && (
                            <div className="flex flex-wrap gap-2 pt-1">
                                {(LOCATION_CATEGORIES.find((l) => l.label === selectedLocationCategory)?.options || []).map((opt) => (
                                    <button
                                        key={opt}
                                        onClick={() => setSelectedLocationOption(opt)}
                                        className={`px-2.5 py-1 rounded-full text-[11px] font-medium transition-all border ${
                                            selectedLocationOption === opt
                                                ? 'bg-sky-100 text-sky-700 border-sky-300'
                                                : 'bg-white text-slate-500 border-slate-200 hover:border-sky-200'
                                        }`}
                                    >
                                        {opt}
                                    </button>
                                ))}
                            </div>
                        )}
                        {selectedLocationCategory === 'Custom' && (
                            <p className="text-[11px] text-slate-400 pt-1">Use the "Background / Location" field below to describe it.</p>
                        )}
                    </div>

                    {/* Text Prompts */}
                    <div className="space-y-4 md:col-span-2 grid grid-cols-1 md:grid-cols-2 gap-6">
                        <div className="space-y-4">
                            <div className="space-y-1">
                                <label className="text-xs font-bold text-slate-500 uppercase tracking-wider">Product Prompt</label>
                                <input
                                    type="text"
                                    value={customProductPrompt}
                                    onChange={(e) => setCustomProductPrompt(e.target.value)}
                                    placeholder="e.g. A sleek black leather handbag with gold hardware..."
                                    className="w-full px-4 py-2 rounded-lg bg-white border border-slate-200 text-sm focus:outline-none focus:ring-2 focus:ring-rose-500/20 focus:border-rose-500 transition-all placeholder:text-slate-400"
                                />
                            </div>
                            <div className="space-y-1">
                                <div className="flex items-center justify-between">
                                    <label className="text-xs font-bold text-slate-500 uppercase tracking-wider">Model Prompt</label>
                                    <div className="flex gap-1">
                                        {MODEL_GENDERS.map((g) => (
                                            <button
                                                key={g}
                                                onClick={() => setSelectedGender(g)}
                                                className={`px-2 py-0.5 rounded-full text-[10px] font-medium border transition-all ${
                                                    selectedGender === g ? 'bg-purple-500 text-white border-purple-500' : 'bg-white text-slate-500 border-slate-200 hover:border-purple-300'
                                                }`}
                                            >
                                                {g}
                                            </button>
                                        ))}
                                    </div>
                                </div>
                                <input
                                    type="text"
                                    value={customModelPrompt}
                                    onChange={(e) => setCustomModelPrompt(e.target.value)}
                                    placeholder="e.g. Young Asian woman, smiling, business casual..."
                                    className="w-full px-4 py-2 rounded-lg bg-white border border-slate-200 text-sm focus:outline-none focus:ring-2 focus:ring-rose-500/20 focus:border-rose-500 transition-all placeholder:text-slate-400"
                                />
                                <div className="flex items-center gap-2 pt-1">
                                    {flags.customModelStudio && (
                                    <button
                                        type="button"
                                        onClick={() => setCustomModelStudioOpen(true)}
                                        className="text-[11px] font-medium text-purple-600 hover:text-purple-800 flex items-center gap-1"
                                    >
                                        <UserCircle2 size={12} /> {selectedCustomModel ? 'Change saved model' : 'Use a saved model'}
                                    </button>
                                    )}
                                    {selectedCustomModel && (
                                        <span className="inline-flex items-center gap-1 pl-1 pr-0.5 py-0.5 rounded-full bg-purple-50 border border-purple-200 text-[11px] text-purple-700">
                                            {selectedCustomModel.name}
                                            <button onClick={() => setSelectedCustomModel(null)} className="p-0.5 hover:text-purple-900">
                                                <X size={10} />
                                            </button>
                                        </span>
                                    )}
                                </div>
                            </div>
                            <div className="space-y-1">
                                <label className="text-xs font-bold text-slate-500 uppercase tracking-wider">Model Posture / Pose</label>
                                <input
                                    type="text"
                                    value={customModelPosture}
                                    onChange={(e) => setCustomModelPosture(e.target.value)}
                                    placeholder="e.g. Sitting on a chair, walking towards camera, holding product up..."
                                    className="w-full px-4 py-2 rounded-lg bg-white border border-slate-200 text-sm focus:outline-none focus:ring-2 focus:ring-rose-500/20 focus:border-rose-500 transition-all placeholder:text-slate-400"
                                />
                            </div>
                        </div>

                        <div className="space-y-1">
                            <label className="text-xs font-bold text-slate-500 uppercase tracking-wider">Background / Location</label>
                            <textarea
                                value={customBackgroundPrompt}
                                onChange={(e) => setCustomBackgroundPrompt(e.target.value)}
                                placeholder="e.g. Modern kitchen, sunny park, luxury office..."
                                className="w-full h-full min-h-[108px] px-4 py-2 rounded-lg bg-white border border-slate-200 text-sm focus:outline-none focus:ring-2 focus:ring-rose-500/20 focus:border-rose-500 transition-all placeholder:text-slate-400 resize-none"
                            />
                        </div>
                    </div>

                    {/* Output choice */}
                    <div className="space-y-2 md:col-span-2">
                        <label className="text-xs font-bold text-slate-500 uppercase tracking-wider">Output</label>
                        <div className="flex flex-wrap gap-2">
                            <button
                                onClick={() => setWantsAutoVideo(false)}
                                className={`px-3 py-1.5 rounded-full text-xs font-medium transition-all duration-200 border ${
                                    !wantsAutoVideo
                                        ? 'bg-slate-900 text-white border-slate-900 shadow-md'
                                        : 'bg-white text-slate-600 border-slate-200 hover:border-slate-400'
                                }`}
                            >
                                Photos Only
                            </button>
                            <button
                                onClick={() => setWantsAutoVideo(true)}
                                className={`px-3 py-1.5 rounded-full text-xs font-medium transition-all duration-200 border ${
                                    wantsAutoVideo
                                        ? 'bg-slate-900 text-white border-slate-900 shadow-md'
                                        : 'bg-white text-slate-600 border-slate-200 hover:border-slate-400'
                                }`}
                            >
                                Photos + Auto Video
                            </button>
                        </div>
                    </div>
                </div>

                <div className="mt-6 pt-6 border-t border-slate-200/50 flex justify-center">
                    <button
                        onClick={() => handleGenerate(undefined, [], undefined, true)}
                        disabled={isProcessingGlobal}
                        className="group relative px-8 py-4 bg-slate-900 text-white font-display font-bold rounded-xl shadow-xl hover:shadow-2xl hover:bg-slate-800 transition-all duration-300 disabled:opacity-50 disabled:cursor-not-allowed overflow-hidden w-full md:w-auto"
                    >
                        <div className="absolute inset-0 bg-gradient-to-r from-rose-500/20 to-blue-500/20 opacity-0 group-hover:opacity-100 transition-opacity"></div>
                        <div className="relative flex items-center justify-center gap-3">
                            <Sparkles size={20} className="text-rose-400" />
                            <span>Generate from Text Prompts</span>
                        </div>
                    </button>
                </div>
            </div>

            {/* Upload Section */}
            <div className="mb-24">
                <UploadZone 
                    onGenerate={handleGenerate}
                    isProcessing={isProcessingGlobal} 
                />
            </div>
            
            {/* Show recent generation if any */}
            {products.length > 0 && products[0].status !== 'idle' && (
                <div className="space-y-12">
                    <div className="flex items-center gap-4 mb-8">
                        <h3 className="text-3xl font-display font-bold text-slate-800">Current Generation</h3>
                        <div className="h-px flex-1 bg-gradient-to-r from-slate-200 to-transparent"></div>
                    </div>
                    <ProductCard
                        key={products[0].id}
                        product={products[0]}
                        onViewImage={openModal}
                        onGenerateVideo={handleGenerateVideo}
                        onRegenerate={handleRegenerate}
                        onSaveEdit={handleSaveEdit}
                        imageEditorEnabled={flags.imageEditor}
                        videoEditorEnabled={flags.videoEditor}
                    />
                </div>
            )}
          </>
        )}
        
        {activeTab === 'history' && (
          <div className="space-y-12">
              <div className="flex items-center gap-4 mb-8">
                  <h3 className="text-3xl font-display font-bold text-slate-800">History</h3>
                  <div className="h-px flex-1 bg-gradient-to-r from-slate-200 to-transparent"></div>
              </div>
              
              {products.length === 0 ? (
                  <div className="text-center py-20 text-slate-500">
                      No generations yet. Go to the Generate tab to create some!
                  </div>
              ) : (
                  products.map((product) => (
                      <ProductCard
                          key={product.id}
                          product={product}
                          onViewImage={openModal}
                          onGenerateVideo={handleGenerateVideo}
                          onRegenerate={handleRegenerate}
                          onSaveEdit={handleSaveEdit}
                          imageEditorEnabled={flags.imageEditor}
                          videoEditorEnabled={flags.videoEditor}
                      />
                  ))
              )}
          </div>
        )}

        {activeTab === 'dashboard' && flags.dashboard && (
          <React.Suspense fallback={<TabFallback />}>
            <Dashboard uid={authUser?.uid} />
          </React.Suspense>
        )}
      </main>
      
      {/* Footer */}
      <footer className="mt-32 py-12 text-center border-t border-slate-200/50 bg-white/30 backdrop-blur-sm">
        <p className="font-serif-logo text-2xl font-bold text-slate-300 italic mb-2">LB Solutions</p>
        <p className="text-slate-400 text-sm">Powered by Marwan & Khayyam</p>
      </footer>
    </div>
  );
};

export default App;