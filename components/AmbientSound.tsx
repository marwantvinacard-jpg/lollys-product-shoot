import React, { useEffect, useRef, useState } from 'react';
import { Volume2, VolumeX } from 'lucide-react';

export const AmbientSound: React.FC = () => {
  const [isPlaying, setIsPlaying] = useState(false);
  const audioContextRef = useRef<AudioContext | null>(null);
  const gainNodeRef = useRef<GainNode | null>(null);
  const oscillatorsRef = useRef<OscillatorNode[]>([]);

  useEffect(() => {
    // Initialize AudioContext on first user interaction to bypass browser policies
    const initAudio = () => {
      if (!audioContextRef.current) {
        audioContextRef.current = new (window.AudioContext || (window as any).webkitAudioContext)();
        
        // Master Gain
        const masterGain = audioContextRef.current.createGain();
        masterGain.gain.value = 0.05; // Keep it very subtle
        masterGain.connect(audioContextRef.current.destination);
        gainNodeRef.current = masterGain;

        // Create Drone Oscillators (The "Pink & Blue" Sound)
        // Osc 1: Deep Bass (The Foundation)
        createOscillator(masterGain, 55, 'sine', 0.5); 
        // Osc 2: Ethereal Mid (The Atmosphere)
        createOscillator(masterGain, 110, 'triangle', 0.2); 
        // Osc 3: Detuned Harmony (The Futuristic Wobble)
        createOscillator(masterGain, 112, 'sine', 0.15);
      }
    };

    const handleInteraction = () => {
      if (!audioContextRef.current) {
        initAudio();
      }
      // We don't auto-play here, we let the user toggle via button, 
      // or we can start if specific criteria met. 
      // For best UX, we'll rely on the toggle button, but init context here.
    };

    window.addEventListener('click', handleInteraction, { once: true });
    return () => {
      window.removeEventListener('click', handleInteraction);
      oscillatorsRef.current.forEach(osc => osc.stop());
      audioContextRef.current?.close();
    };
  }, []);

  const createOscillator = (destination: AudioNode, freq: number, type: OscillatorType, gain: number) => {
    if (!audioContextRef.current) return;
    const osc = audioContextRef.current.createOscillator();
    const oscGain = audioContextRef.current.createGain();
    
    osc.type = type;
    osc.frequency.setValueAtTime(freq, audioContextRef.current.currentTime);
    
    // Add LFO for "Breathing" effect
    const lfo = audioContextRef.current.createOscillator();
    lfo.type = 'sine';
    lfo.frequency.value = 0.1; // Slow breath
    const lfoGain = audioContextRef.current.createGain();
    lfoGain.gain.value = gain * 0.3;
    
    lfo.connect(lfoGain);
    lfoGain.connect(oscGain.gain);
    lfo.start();

    oscGain.gain.value = gain;
    osc.connect(oscGain);
    oscGain.connect(destination);
    osc.start();
    oscillatorsRef.current.push(osc);
  };

  const toggleSound = () => {
    if (!audioContextRef.current) return;

    if (audioContextRef.current.state === 'suspended') {
      audioContextRef.current.resume();
    }

    if (isPlaying) {
      gainNodeRef.current?.gain.setTargetAtTime(0, audioContextRef.current.currentTime, 0.5);
    } else {
      gainNodeRef.current?.gain.setTargetAtTime(0.08, audioContextRef.current.currentTime, 1);
    }
    setIsPlaying(!isPlaying);
  };

  return (
    <button 
      onClick={toggleSound}
      className="fixed bottom-6 right-6 z-50 p-3 rounded-full glass-panel hover:bg-white/80 transition-all duration-300 shadow-lg group"
      title={isPlaying ? "Mute Ambient Sound" : "Play Ambient Sound"}
    >
      <div className="relative">
        {isPlaying && (
          <span className="absolute -inset-1 rounded-full border border-rose-300 animate-ping opacity-75"></span>
        )}
        {isPlaying ? (
          <Volume2 size={20} className="text-slate-800 relative z-10" />
        ) : (
          <VolumeX size={20} className="text-slate-400 relative z-10" />
        )}
      </div>
    </button>
  );
};
