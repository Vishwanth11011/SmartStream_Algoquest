import React, { useCallback, useState } from 'react';
import { Upload, AlertCircle, Loader2, FileWarning, CheckCircle, Copy } from 'lucide-react';
import { sendAIMetadata } from '../lib/auth';
import { analyzeFile } from '../lib/ai';

interface FilePickerProps {
  // Now returns an Array of files and a Map of their AI recommendations
  onFilesSelected: (files: File[], algos: Map<string, string>) => void;
  disabled?: boolean;
}

const MAX_TOTAL_BYTES = 1 * 1024 * 1024 * 1024; // 1GB Total Limit

export const FilePicker: React.FC<FilePickerProps> = ({ onFilesSelected, disabled }) => {
  const [status, setStatus] = useState<'idle' | 'analyzing' | 'error'>('idle');
  const [progressText, setProgressText] = useState('');
  const [errorMsg, setErrorMsg] = useState('');

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

        // A. Client-Side Entropy
        const recommendation = await analyzeFile(file);
        algoMap.set(file.name, recommendation);

        // B. Generate Vector (1KB Sample)
        const sampleBuffer = await file.slice(0, 1024).arrayBuffer();
        const vector = Array.from(new Uint8Array(sampleBuffer));

        // C. Backend Sync
        await sendAIMetadata({
          filename: file.name,
          size: file.size,
          fileType: file.type,
          algo: recommendation,
          vector: vector
        });
      }

      console.log("✅ Batch Analysis Complete");
      setStatus('idle');
      
      // Pass valid batch to parent
      onFilesSelected(files, algoMap);

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
    <div 
      onDragOver={(e) => e.preventDefault()}
      onDrop={onDrop}
      className={`relative border-2 border-dashed rounded-xl p-8 flex flex-col items-center justify-center transition-all h-64
        ${disabled ? 'border-gray-700 opacity-50 cursor-not-allowed' : 
          status === 'error' ? 'border-red-500 bg-red-900/10' :
          'border-blue-500 hover:border-blue-400 hover:bg-gray-800/50 cursor-pointer'}`}
    >
      {/* LOADING STATE */}
      {status === 'analyzing' && (
        <div className="absolute inset-0 bg-gray-900/90 flex flex-col items-center justify-center z-10 rounded-xl backdrop-blur-sm">
          <Loader2 className="w-10 h-10 text-blue-400 animate-spin mb-4" />
          <h3 className="text-lg font-bold text-blue-300">Nano-AI Batch Scan</h3>
          <p className="text-gray-400 text-xs font-mono mt-2">{progressText}</p>
        </div>
      )}

      {/* ERROR STATE */}
      {status === 'error' && (
        <div className="absolute top-4 w-max bg-red-500/20 text-red-400 px-4 py-2 rounded-full border border-red-500/50 flex items-center gap-2 text-sm">
          <FileWarning className="w-4 h-4" /> {errorMsg}
        </div>
      )}

      {/* IDLE STATE */}
      <div className={`transition-opacity duration-300 ${status !== 'idle' ? 'opacity-20' : 'opacity-100'}`}>
        <div className="bg-blue-500/20 p-4 rounded-full mb-4 mx-auto w-max">
          <Copy className="w-8 h-8 text-blue-400" />
        </div>
        <h3 className="text-xl font-semibold text-white mb-2 text-center">Multi-File Transfer</h3>
        <p className="text-gray-400 text-sm mb-6 text-center">Max Batch Size: 1 GB</p>
        
        <input 
          type="file" 
          multiple // <--- ENABLE MULTIPLE SELECTION
          className="hidden" 
          id="fileInput" 
          disabled={disabled || status !== 'idle'}
          onChange={(e) => e.target.files && processBatch(e.target.files)}
        />
        <label 
          htmlFor="fileInput" 
          className="px-6 py-2.5 bg-blue-600 text-white rounded-lg text-sm font-bold hover:bg-blue-500 cursor-pointer"
        >
          Select Files
        </label>
      </div>

      <div className="absolute bottom-4 flex items-center gap-2 text-[10px] text-gray-500 bg-gray-900 px-3 py-1 rounded-full border border-gray-700">
        <AlertCircle className="w-3 h-3" />
        <span>Entropy Vector Calculation Active</span>
      </div>
    </div>
  );
};