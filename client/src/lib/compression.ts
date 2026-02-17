import pako from 'pako';

// --- INTELLIGENCE CONFIGURATION ---
const CONFIG = {
  SAMPLE_SIZE: 512 * 1024, // Analyze first 512KB for accurate entropy
  ENTROPY_CUTOFF: 7.4,     // Above this, data is likely already compressed (Randomness limit)
  TEXT_ENTROPY_MAX: 5.5,   // Text is usually predictable (low entropy)
  RANSOMWARE_THRESHOLD: 7.9 // Text files with this entropy are likely encrypted malware
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
 * 🧠 CORE INTELLIGENCE: Shannon Entropy Calculator
 * Measures information density. 
 * 0 = Blank file, 8 = Maximum Compression/Encryption.
 */
const calculateEntropy = (data: Uint8Array): number => {
  const frequencies = new Array(256).fill(0);
  const total = data.length;

  // 1. Frequency Analysis
  for (let i = 0; i < total; i++) {
    frequencies[data[i]]++;
  }

  // 2. Shannon Formula: H(x) = -Σ p(x) log2 p(x)
  let entropy = 0;
  for (let i = 0; i < 256; i++) {
    if (frequencies[i] > 0) {
      const p = frequencies[i] / total;
      entropy -= p * Math.log2(p);
    }
  }

  return entropy;
};

/**
 * 🕵️ DEEP INSPECTION: Magic Number Detection
 * Identifies the TRUE file type, ignoring the extension.
 */
const detectTrueType = (header: Uint8Array): string => {
  const hex = Array.from(header.slice(0, 8)).map(b => b.toString(16).padStart(2, '0')).join('').toUpperCase();
  
  if (hex.startsWith('FFD8FF')) return 'image/jpeg';
  if (hex.startsWith('89504E47')) return 'image/png';
  if (hex.startsWith('25504446')) return 'application/pdf';
  if (hex.startsWith('504B0304')) return 'application/zip'; // Zip, Docx, Jar, Apk
  if (hex.startsWith('52617221')) return 'application/x-rar';
  if (hex.startsWith('1F8B')) return 'application/gzip';
  if (hex.startsWith('7B')) return 'application/json'; // JSON starts with {
  
  return 'unknown/binary';
};

/**
 * 🚀 THE ENGINE: Smart Strategy Selection
 */
export const processFile = async (file: File): Promise<{ file: File | Blob, meta: FileMeta }> => {
  const buffer = await file.arrayBuffer();
  const rawData = new Uint8Array(buffer);
  
  // A. SAMPLING & ANALYSIS
  const sample = rawData.slice(0, CONFIG.SAMPLE_SIZE);
  const entropy = calculateEntropy(sample);
  const trueType = detectTrueType(sample);
  
  // B. SECURITY HEURISTICS
  let riskScore = 0;
  let securityStatus: 'Safe' | 'Suspicious' = 'Safe';
  let reason = 'Standard File';

  // Rule: Text files shouldn't be random. If they are, it's hidden code or crypto-locker.
  if ((file.name.endsWith('.txt') || file.name.endsWith('.js')) && entropy > CONFIG.RANSOMWARE_THRESHOLD) {
    riskScore = 95;
    securityStatus = 'Suspicious';
    reason = 'Abnormal Entropy in Text File (Potential Encrypted Payload)';
  }

  // C. COMPRESSION STRATEGY MATRIX
  let processedData = rawData;
  let algorithm = 'Store (No-Op)';

  // STRATEGY 1: SKIP (Already Compressed Media)
  // JPEGs, PNGs, MP4s, and ZIPs don't shrink. Compressing them wastes CPU and grows file size.
  if (entropy > CONFIG.ENTROPY_CUTOFF || trueType.startsWith('image') || trueType.includes('zip') || trueType.includes('rar')) {
    algorithm = 'Store (Passthrough)';
    // Logic: Return raw data immediately.
  }
  
  // STRATEGY 2: ULTRA (Text/Code/Data)
  // Text relies on repeating patterns. DEFLATE Level 9 crushes this.
  else if (entropy < CONFIG.TEXT_ENTROPY_MAX || trueType.includes('json') || file.type.includes('text')) {
    try {
      algorithm = 'Deflate (Ultra Level 9)';
      // Pako Level 9 is slower but provides maximum density
      processedData = pako.deflate(rawData, { level: 9 });
    } catch (e) {
      console.warn("Ultra compression failed, falling back.");
    }
  }
  
  // STRATEGY 3: BALANCED (General Binary)
  // Binaries (EXEs, DATs) have some patterns but are dense. Gzip Level 6 is the sweet spot.
  else {
    try {
      algorithm = 'Gzip (Standard Level 6)';
      processedData = pako.gzip(rawData, { level: 6 });
    } catch (e) {
      algorithm = 'Store (Fallback)';
    }
  }

  // D. PERFORMANCE VALIDATION (The "Regret" Check)
  // Sometimes compression accidentally makes the file BIGGER (due to headers).
  // If so, discard the compressed version and send raw.
  if (processedData.length >= rawData.length) {
    algorithm = 'Store (Optimization)';
    processedData = rawData;
  }

  // E. FINAL PACKAGING
  // We explicitly tag the output type to help the Receiver know it's binary data
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
      mimeType: trueType
    }
  };
};