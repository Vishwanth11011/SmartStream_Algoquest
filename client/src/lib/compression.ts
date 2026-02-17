import { gzipSync, deflateSync } from 'fflate';

// --- CONFIGURATION ---
const CONFIG = {
  SAMPLE_SIZE: 512 * 1024, 
  RANSOMWARE_THRESHOLD: 7.9 
};

export interface FileMeta {
  algorithm: string;
  originalSize: number;
  compressedSize: number;
  entropy: number;
  securityStatus: 'Safe' | 'Suspicious';
  riskScore: number;
  reason: string;
  mimeType: string;
}

/**
 * 🧠 1. CALCULATE ENTROPY
 * Measures randomness (0.0 - 8.0).
 */
const calculateEntropy = (data: Uint8Array): number => {
  const frequencies = new Array(256).fill(0);
  for (let i = 0; i < data.length; i++) frequencies[data[i]]++;
  
  let entropy = 0;
  const total = data.length;
  for (let i = 0; i < 256; i++) {
    if (frequencies[i] > 0) {
      const p = frequencies[i] / total;
      entropy -= p * Math.log2(p);
    }
  }
  return entropy;
};

/**
 * 🕵️ 2. IDENTIFY FILE FAMILY (Magic Numbers)
 */
const detectCompressionFamily = (header: Uint8Array): string => {
  const hex = Array.from(header.slice(0, 8)).map(b => b.toString(16).padStart(2, '0')).join('').toUpperCase();
  
  // --- A. DEFLATE FAMILY (Zip, Docs, Png) ---
  if (hex.startsWith('504B0304')) return 'DEFLATE_ZIP';
  if (hex.startsWith('89504E47')) return 'DEFLATE_PNG'; 
  if (hex.startsWith('1F8B')) return 'DEFLATE_GZIP';

  // --- B. LZMA FAMILY (7z, XZ) ---
  if (hex.startsWith('377ABCAF271C')) return 'LZMA_7Z';
  if (hex.startsWith('FD377A585A00')) return 'LZMA_XZ';

  // --- C. ZSTD FAMILY ---
  if (hex.startsWith('28B52FFD')) return 'ZSTD';

  // --- D. LZW FAMILY (Gif, Tiff) ---
  if (hex.startsWith('47494638')) return 'LZW_GIF';
  if (hex.startsWith('49492A00') || hex.startsWith('4D4D002A')) return 'LZW_TIFF';

  // --- E. DCT MEDIA FAMILY (Jpeg, Video) ---
  if (hex.startsWith('FFD8FF')) return 'DCT_JPEG';
  if (hex.startsWith('000000') && (hex.includes('66747970') || hex.includes('6D6F6F76'))) return 'DCT_VIDEO'; 

  // --- F. AUDIO PREDICTIVE FAMILY (Mp3, Flac) ---
  if (hex.startsWith('494433') || hex.startsWith('FFF3') || hex.startsWith('FFF2')) return 'AUDIO_MP3';
  if (hex.startsWith('664C6143')) return 'AUDIO_FLAC';

  // --- G. TEXT/DATA (Check for JSON/XML starts) ---
  // Simple check for text-like start bytes
  const textStart = new TextDecoder().decode(header.slice(0, 5));
  if (textStart.startsWith('{') || textStart.startsWith('<') || textStart.match(/^[a-zA-Z0-9]/)) return 'TEXT_DATA';

  return 'UNKNOWN_BINARY';
};

/**
 * 🚀 3. THE SMART PROCESSOR (Aggressive Mode)
 * Selects compression based on type, IGNORING entropy to force compression.
 */
export const processFile = async (file: File): Promise<{ file: Blob, meta: FileMeta }> => {
  const buffer = await file.arrayBuffer();
  const rawData = new Uint8Array(buffer);
  
  const sample = rawData.slice(0, CONFIG.SAMPLE_SIZE);
  const entropy = calculateEntropy(sample);
  const family = detectCompressionFamily(sample);
  
  let processedData: any = rawData;
  let algorithm = 'Store (No-Op)';
  let securityStatus: 'Safe' | 'Suspicious' = 'Safe';
  let riskScore = 0;
  let reason = 'Standard File';

  // --- SECURITY CHECK ---
  if ((file.name.endsWith('.txt') || file.name.endsWith('.js')) && entropy > CONFIG.RANSOMWARE_THRESHOLD) {
    securityStatus = 'Suspicious';
    riskScore = 95;
    reason = 'Abnormal Entropy in Text (Potential Encrypted Payload)';
  }

  // --- HEURISTIC SELECTION (FORCED COMPRESSION) ---

  // STRATEGY 1: TEXT & DATA -> DEFLATE (Ultra)
  // Text, JSON, Code, XML, SVGs compress best with raw DEFLATE at high levels.
  if (family === 'TEXT_DATA' || file.type.includes('text') || file.name.endsWith('.json') || file.name.endsWith('.js')) {
    try {
      algorithm = 'Deflate (Ultra Level 9)';
      processedData = deflateSync(rawData, { level: 9 });
    } catch (e) {
      console.warn("Deflate failed, falling back to Gzip");
      algorithm = 'Gzip (Fallback)';
      processedData = gzipSync(rawData, { level: 6 });
    }
  }

  // STRATEGY 2: EVERYTHING ELSE -> GZIP (Standard)
  // Images, Videos, Binaries, Archives. 
  // Even if already compressed, we wrap them in Gzip as requested.
  else {
    try {
      algorithm = 'Gzip (Standard Level 6)';
      processedData = gzipSync(rawData, { level: 6 });
    } catch (e) {
      // If compression crashes, we must fallback to store to ensure transfer
      algorithm = 'Store (Error Fallback)';
      processedData = rawData;
    }
  }

  // NOTE: Regret Check (size comparison) removed to strictly follow "Do not pass through" rule.
  // We send the compressed version even if it's slightly larger due to headers.

  const resultBlob = new Blob([processedData], { type: 'application/octet-stream' });

  return {
    file: resultBlob,
    meta: {
      algorithm,
      originalSize: rawData.length,
      compressedSize: processedData.length,
      entropy,
      securityStatus,
      riskScore,
      reason,
      mimeType: family
    }
  };
};