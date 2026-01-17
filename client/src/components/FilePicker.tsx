import React, { useCallback } from 'react';
import { Upload, AlertCircle } from 'lucide-react';
import { analyzeFile } from '../lib/ai';

interface FilePickerProps {
  onFileSelected: (file: File, algo: string) => void;
  disabled?: boolean;
}

export const FilePicker: React.FC<FilePickerProps> = ({ onFileSelected, disabled }) => {
  
  const handleFile = useCallback(async (file: File) => {
    // 1. Trigger AI Scan
    console.log("🤖 AI Scanning...");
    const recommendation = await analyzeFile(file);
    console.log(`✅ AI Recommendation: ${recommendation}`);
    
    // 2. Pass result back to parent
    onFileSelected(file, recommendation);
  }, [onFileSelected]);

  const onDrop = (e: React.DragEvent) => {
    e.preventDefault();
    if (disabled) return;
    if (e.dataTransfer.files?.[0]) handleFile(e.dataTransfer.files[0]);
  };

  return (
    <div 
      onDragOver={(e) => e.preventDefault()}
      onDrop={onDrop}
      className={`border-2 border-dashed rounded-xl p-8 flex flex-col items-center justify-center transition-colors 
        ${disabled ? 'border-gray-600 opacity-50 cursor-not-allowed' : 'border-blue-500 hover:border-blue-400 hover:bg-gray-800 cursor-pointer'}`}
    >
      <div className="bg-blue-500/20 p-3 rounded-full mb-3">
        <Upload className="w-6 h-6 text-blue-400" />
      </div>
      <h3 className="text-lg font-semibold text-white mb-1">Drag & Drop file here</h3>
      <p className="text-gray-400 text-sm mb-4">or click to browse</p>
      
      <input 
        type="file" 
        className="hidden" 
        id="fileInput" 
        disabled={disabled}
        onChange={(e) => e.target.files?.[0] && handleFile(e.target.files[0])}
      />
      <label 
        htmlFor="fileInput" 
        className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${disabled ? 'bg-gray-700 text-gray-400' : 'bg-blue-600 text-white hover:bg-blue-700 cursor-pointer'}`}
      >
        Choose File
      </label>

      <div className="mt-4 flex items-center gap-2 text-[10px] text-gray-500 bg-gray-900 px-3 py-1 rounded-full border border-gray-700">
        <AlertCircle className="w-3 h-3" />
        <span>Scanned by Nano-AI</span>
      </div>
    </div>
  );
};