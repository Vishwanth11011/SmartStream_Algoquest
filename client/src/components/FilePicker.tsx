import React, { useCallback, useState, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { UploadCloud, Loader2, Cpu, AlertCircle, CheckCircle, FileWarning } from 'lucide-react';
import { analyzeFile } from '../lib/ai';

// SERVER URL for AI Metadata Sync
const SERVER_URL = import.meta.env.VITE_SERVER_URL || 'http://localhost:3001';

interface FilePickerProps {
  onFilesSelected: (files: File[], algos: Map<string, string>) => void;
  disabled?: boolean;
}

const MAX_TOTAL_BYTES = 1 * 1024 * 1024 * 1024; // 1GB Total Limit

export const FilePicker: React.FC<FilePickerProps> = ({ onFilesSelected, disabled }) => {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [status, setStatus] = useState<'idle' | 'analyzing' | 'error'>('idle');
  const [progressText, setProgressText] = useState('');
  const [errorMsg, setErrorMsg] = useState('');

  // --- LOGIC: BATCH PROCESSING (From your stable version) ---
  const processBatch = useCallback(async (fileList: FileList | File[]) => {
    const files = Array.from(fileList);
    if (files.length === 0) return;

    setErrorMsg('');
    setStatus('analyzing');
    
    try {
      // 1. TOTAL SIZE CHECK
      const totalSize = files.reduce((acc, f) => acc + f.size, 0);
      if (totalSize > MAX_TOTAL_BYTES) {
        throw new Error(`Batch too large! Limit is 1GB. (Selected: ${(totalSize / 1024 / 1024 / 1024).toFixed(2)} GB)`);
      }

      const algoMap = new Map<string, string>();

      // 2. SEQUENTIAL AI ANALYSIS (Analyze one by one)
      for (let i = 0; i < files.length; i++) {
        const file = files[i];
        setProgressText(`Analyzing ${i + 1}/${files.length}: ${file.name}`);

        // A. Client-Side Entropy (Using restored ai.ts)
        const recommendation = await analyzeFile(file);
        algoMap.set(file.name, recommendation);

        // B. Generate Vector (1KB Sample for Backend Logs)
        const sampleBuffer = await file.slice(0, 1024).arrayBuffer();
        const vector = Array.from(new Uint8Array(sampleBuffer));

        // C. Backend Sync (Direct Fetch to ensure it works)
        try {
          await fetch(`${SERVER_URL}/api/ai/analyze`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              filename: file.name,
              size: file.size,
              fileType: file.type,
              algo: recommendation,
              vector: vector
            })
          });
        } catch (e) {
          console.warn("Backend AI Log failed (Non-critical):", e);
        }
      }

      console.log("✅ Batch Analysis Complete");
      setProgressText("Optimization Complete!");
      await new Promise(r => setTimeout(r, 500)); // Visual pause

      setStatus('idle');
      
      // Pass valid batch to parent
      onFilesSelected(files, algoMap);
      
      // Reset input
      if (fileInputRef.current) fileInputRef.current.value = '';

    } catch (err: any) {
      console.error("Batch Failed:", err);
      setStatus('error');
      setErrorMsg(err.message || "Batch Analysis Failed");
    }
  }, [onFilesSelected]);

  const onDrop = (e: React.DragEvent) => {
    e.preventDefault();
    if (disabled || status === 'analyzing') return;
    if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
      processBatch(e.dataTransfer.files);
    }
  };

  return (
    <div className="w-full">
      <input
        type="file"
        multiple // ✅ MULTIPLE FILES ENABLED
        className="hidden"
        ref={fileInputRef}
        onChange={(e) => e.target.files && processBatch(e.target.files)}
        disabled={disabled || status === 'analyzing'}
      />

      <AnimatePresence mode='wait'>
        {status === 'analyzing' ? (
          // 1. ANALYZING STATE (Modern UI + Real Progress Text)
          <motion.div 
            initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -10 }}
            className="border-2 border-blue-500/30 bg-blue-500/10 border-dashed rounded-xl p-8 flex flex-col items-center justify-center h-48"
          >
             <div className="relative">
               <Cpu className="w-10 h-10 text-blue-400 animate-pulse" />
               <div className="absolute -top-1 -right-1 w-3 h-3 bg-blue-500 rounded-full animate-ping" />
             </div>
             <p className="mt-4 text-sm font-bold text-blue-300 animate-pulse">{progressText}</p>
             <p className="text-xs text-blue-400/60 mt-2">Calculating Shannon Entropy...</p>
          </motion.div>
        ) : (
          // 2. IDLE / ERROR STATE
          <motion.div 
            initial={{ opacity: 0 }} animate={{ opacity: 1 }}
            onDragOver={(e) => e.preventDefault()}
            onDrop={onDrop}
            onClick={() => !disabled && fileInputRef.current?.click()}
            className={`
              relative group cursor-pointer border-2 border-dashed rounded-xl p-8 h-48 flex flex-col items-center justify-center transition-all duration-300
              ${disabled 
                ? 'border-gray-800 bg-gray-900/50 cursor-not-allowed opacity-50' 
                : status === 'error'
                  ? 'border-red-500/50 bg-red-900/10 hover:bg-red-900/20'
                  : 'border-gray-700 hover:border-blue-500 hover:bg-gray-800/50 hover:shadow-[0_0_20px_rgba(59,130,246,0.1)]'
              }
            `}
          >
            {/* Error Banner */}
            {status === 'error' && (
              <div className="absolute top-4 bg-red-500/20 text-red-400 px-3 py-1 rounded-full border border-red-500/50 flex items-center gap-2 text-xs font-bold">
                <FileWarning className="w-3 h-3" /> {errorMsg}
              </div>
            )}

            <div className={`bg-gray-800 p-4 rounded-full mb-4 group-hover:scale-110 transition-transform duration-300 ${status === 'error' ? 'bg-red-500/20' : 'group-hover:bg-blue-600/20'}`}>
              <UploadCloud className={`w-8 h-8 ${disabled ? 'text-gray-600' : status === 'error' ? 'text-red-400' : 'text-blue-400 group-hover:text-blue-300'}`} />
            </div>
            
            <div className="text-center space-y-1">
              <p className={`text-sm font-bold ${disabled ? 'text-gray-600' : 'text-gray-300 group-hover:text-white'}`}>
                {disabled ? 'Connect to Peer First' : 'Click to Select Files'}
              </p>
              <p className="text-xs text-gray-500">Max Batch Size: 1 GB • AI Compression Active</p>
            </div>

            {/* AI Badge */}
            <div className="absolute bottom-2 flex items-center gap-2 text-[10px] text-gray-500 bg-gray-900 px-3 py-1 rounded-full border border-gray-700">
              <AlertCircle className="w-3 h-3" />
              <span>Entropy Vector Calculation Active</span>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
};