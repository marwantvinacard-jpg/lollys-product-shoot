import React, { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { X, Sparkles, Wand2, Save, Trash2, UserCircle2 } from 'lucide-react';
import { Button } from './Button';
import { createCustomModel, editCustomModelImage, saveCustomModel, deleteCustomModel } from '../services/geminiService';
import { subscribeToMyCustomModels } from '../services/customModels';
import { MODEL_GENDERS } from '../services/taxonomy';
import { CustomModel } from '../types';

interface CustomModelStudioProps {
  isOpen: boolean;
  onClose: () => void;
  uid: string;
  onSelect: (model: CustomModel) => void;
}

export const CustomModelStudio: React.FC<CustomModelStudioProps> = ({ isOpen, onClose, uid, onSelect }) => {
  const [savedModels, setSavedModels] = useState<CustomModel[]>([]);
  const [prompt, setPrompt] = useState('');
  const [gender, setGender] = useState<string>('Unspecified');
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [name, setName] = useState('');
  const [instruction, setInstruction] = useState('');
  const [generating, setGenerating] = useState(false);
  const [refining, setRefining] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!isOpen || !uid) return;
    const unsubscribe = subscribeToMyCustomModels(uid, setSavedModels);
    return unsubscribe;
  }, [isOpen, uid]);

  useEffect(() => {
    if (!isOpen) {
      setPrompt('');
      setPreviewUrl(null);
      setName('');
      setInstruction('');
      setError(null);
    }
  }, [isOpen]);

  const handleGenerate = async () => {
    if (!prompt.trim()) return;
    setError(null);
    setGenerating(true);
    try {
      const result = await createCustomModel(prompt.trim(), gender);
      setPreviewUrl(result.url);
    } catch (err: any) {
      setError(err?.message || 'Failed to generate model. Please try again.');
    } finally {
      setGenerating(false);
    }
  };

  const handleRefine = async () => {
    if (!previewUrl || !instruction.trim()) return;
    setError(null);
    setRefining(true);
    try {
      const result = await editCustomModelImage(previewUrl, instruction.trim());
      setPreviewUrl(result.url);
      setInstruction('');
    } catch (err: any) {
      setError(err?.message || 'Failed to refine model. Please try again.');
    } finally {
      setRefining(false);
    }
  };

  const handleSave = async () => {
    if (!previewUrl) return;
    setError(null);
    setSaving(true);
    try {
      await saveCustomModel(name.trim() || 'My Model', gender, prompt.trim(), previewUrl);
      setPreviewUrl(null);
      setPrompt('');
      setName('');
    } catch (err: any) {
      setError(err?.message || 'Failed to save model. Please try again.');
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (modelId: string) => {
    try {
      await deleteCustomModel(modelId);
    } catch (err) {
      console.error('Failed to delete custom model', err);
    }
  };

  if (!isOpen) return null;

  return createPortal(
    <div className="fixed inset-0 z-[110] flex items-center justify-center bg-slate-900/50 backdrop-blur-sm p-4">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-2xl border border-slate-100 max-h-[90vh] flex flex-col">
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-100">
          <div className="flex items-center gap-2">
            <UserCircle2 size={18} className="text-rose-500" />
            <h3 className="font-display font-bold text-slate-900">Custom Model Studio</h3>
          </div>
          <button onClick={onClose} className="p-1.5 rounded-full hover:bg-slate-100 text-slate-400 hover:text-slate-700 transition-colors">
            <X size={18} />
          </button>
        </div>

        <div className="overflow-y-auto p-6 space-y-8">
          {savedModels.length > 0 && (
            <div className="space-y-3">
              <p className="text-xs font-bold text-slate-500 uppercase tracking-wider">Your Models</p>
              <div className="grid grid-cols-3 sm:grid-cols-4 gap-3">
                {savedModels.map((m) => (
                  <div key={m.id} className="group relative rounded-xl overflow-hidden border border-slate-200 aspect-square">
                    <img src={m.imageUrl} alt={m.name} className="w-full h-full object-cover cursor-pointer" onClick={() => onSelect(m)} />
                    <div className="absolute inset-x-0 bottom-0 bg-black/60 text-white text-[10px] px-2 py-1 truncate">{m.name}</div>
                    <button
                      onClick={() => handleDelete(m.id)}
                      className="absolute top-1 right-1 p-1 rounded-full bg-black/50 text-white opacity-0 group-hover:opacity-100 transition-opacity hover:bg-red-500"
                      title="Delete this model"
                    >
                      <Trash2 size={12} />
                    </button>
                  </div>
                ))}
              </div>
            </div>
          )}

          <div className="space-y-4 pt-2 border-t border-slate-100">
            <p className="text-xs font-bold text-slate-500 uppercase tracking-wider">Create a New Model</p>

            <div className="flex flex-wrap gap-2">
              {MODEL_GENDERS.map((g) => (
                <button
                  key={g}
                  onClick={() => setGender(g)}
                  className={`px-3 py-1.5 rounded-full text-xs font-medium border transition-all ${
                    gender === g ? 'bg-rose-500 text-white border-rose-500' : 'bg-white text-slate-600 border-slate-200 hover:border-rose-300'
                  }`}
                >
                  {g}
                </button>
              ))}
            </div>

            <textarea
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              rows={3}
              placeholder="Describe your model, e.g. Young Latina woman, curly dark hair, athletic build, warm smile..."
              className="w-full px-3 py-2 rounded-lg border border-slate-200 text-sm focus:outline-none focus:ring-2 focus:ring-rose-500/20 focus:border-rose-500 transition-all resize-none"
            />

            <Button onClick={handleGenerate} isLoading={generating} disabled={!prompt.trim()} variant="primary" size="sm" className="bg-slate-900 hover:bg-slate-800">
              <Sparkles size={14} className="mr-1.5" /> Generate
            </Button>

            {error && <p className="text-xs text-red-500">{error}</p>}

            {previewUrl && (
              <div className="flex flex-col sm:flex-row gap-4 p-4 rounded-xl bg-slate-50 border border-slate-100">
                <img src={previewUrl} alt="Model preview" className="w-full sm:w-40 h-40 object-cover rounded-lg shrink-0" />
                <div className="flex-1 space-y-3">
                  <div className="space-y-1.5">
                    <label className="text-[10px] font-bold text-slate-500 uppercase tracking-wider">Refine (keeps the same person)</label>
                    <div className="flex gap-2">
                      <input
                        type="text"
                        value={instruction}
                        onChange={(e) => setInstruction(e.target.value)}
                        placeholder="e.g. give her a red dress, add glasses..."
                        className="flex-1 px-3 py-1.5 rounded-lg border border-slate-200 text-xs focus:outline-none focus:ring-2 focus:ring-rose-500/20 focus:border-rose-500"
                      />
                      <Button onClick={handleRefine} isLoading={refining} disabled={!instruction.trim()} variant="outline" size="sm">
                        <Wand2 size={12} className="mr-1" /> Refine
                      </Button>
                    </div>
                  </div>
                  <div className="space-y-1.5">
                    <label className="text-[10px] font-bold text-slate-500 uppercase tracking-wider">Name</label>
                    <div className="flex gap-2">
                      <input
                        type="text"
                        value={name}
                        onChange={(e) => setName(e.target.value)}
                        placeholder="My Model"
                        className="flex-1 px-3 py-1.5 rounded-lg border border-slate-200 text-xs focus:outline-none focus:ring-2 focus:ring-rose-500/20 focus:border-rose-500"
                      />
                      <Button onClick={handleSave} isLoading={saving} variant="primary" size="sm" className="bg-rose-500 hover:bg-rose-600 border-none">
                        <Save size={12} className="mr-1" /> Save
                      </Button>
                    </div>
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>,
    document.body
  );
};
