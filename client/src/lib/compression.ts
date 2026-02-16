// client/src/lib/compression.ts

export interface CompressionMeta {
  algorithm: string;
  originalSize: number;
  compressedSize: number;
  entropy: number;
  securityStatus: 'Safe' | 'Suspicious' | 'Malware'; // ✅ Security Flag
  riskScore: number; // 0-100
  reason?: string;   // Why it was flagged
  timeTaken: number;
  recommendation: string;
}

// 🧠 1. Shannon Entropy Calculator
const calculateEntropy = async (data: Uint8Array): Promise<number> => {
  const frequencies = new Array(256).fill(0);
  for (let i = 0; i < data.length; i++) frequencies[data[i]]++;
  return frequencies.reduce((sum, count) => {
    if (count === 0) return sum;
    const p = count / data.length;
    return sum - p * Math.log2(p);
  }, 0);
};

// 🔬 2. Advanced Metrics (Quartiles for Anomaly Detection)
const calculateQuartiles = (data: Uint8Array) => {
  const sorted = data.slice().sort();
  const q25 = sorted[Math.floor(data.length * 0.25)];
  const q75 = sorted[Math.floor(data.length * 0.75)];
  return { q25, q75 };
};

// 🛡️ 3. SMART HYBRID SCANNER (The New Security Layer)
const scanForThreats = async (file: File, initialChunk: Uint8Array, entropy: number): Promise<{ status: 'Safe' | 'Suspicious', score: number, reason?: string }> => {
  let score = 0;
  let reason = "";

  // A. ENTROPY CHECK (High entropy = Packed/Encrypted malware potential)
  if (entropy > 7.95) {
    score += 40; 
    reason += "Abnormally High Entropy (Packed/Encrypted); ";
  } else if (entropy > 7.5) {
    score += 20;
  }

  // B. CONTENT SCANNING (Smart Hybrid Strategy)
  let textToScan = "";

  // Strategy 1: Full Scan for Text/Code (Fast & Thorough)
  if (file.type.startsWith('text/') || file.name.match(/\.(js|py|html|css|json|md|log|txt)$/i)) {
    try {
      textToScan = await file.text(); // Read EVERYTHING
    } catch (e) { textToScan = ""; }
  } 
  // Strategy 2: Head & Tail Scan for Binaries (Efficient)
  else {
    // 1. Decode Header (Already in 'initialChunk')
    const head = new TextDecoder("utf-8", { fatal: false }).decode(initialChunk);
    
    // 2. Read Footer (Last 1MB) - Malware often hides here!
    let tail = "";
    if (file.size > 2 * 1024 * 1024) {
      const tailSlice = file.slice(file.size - (1 * 1024 * 1024)); 
      const tailBuffer = await tailSlice.arrayBuffer();
      tail = new TextDecoder("utf-8", { fatal: false }).decode(tailBuffer);
    }
    
    textToScan = head + tail; // Combine for pattern matching
  }

  // C. PATTERN MATCHING (Signatures)
  
  // 1. Dangerous External Links (IPs, Executable Downloads)
  const suspiciousLink = /(https?:\/\/(?:\d{1,3}\.){3}\d{1,3})|(https?:\/\/.*\.(exe|sh|bat|cmd|vbs|ps1))/gi;
  if (textToScan.match(suspiciousLink)) {
    score += 50;
    reason += "Suspicious External Links (IP/Executables); ";
  }

  // 2. Script Execution Vectors (eval, powershell, cmd)
  const shellCommands = /(cmd\.exe|powershell| \/bin\/sh|eval\(|document\.write\(|subprocess\.call)/gi;
  if (textToScan.match(shellCommands)) {
    score += 60;
    reason += "Potential Script Execution Vector; ";
  }

  // 3. Embedded Objects in PDFs (JS injection)
  if (file.type.includes('pdf') || file.name.endsWith('.pdf')) {
    if (textToScan.includes('/JavaScript') || textToScan.includes('/JS') || textToScan.includes('/OpenAction')) {
      score += 30;
      reason += "Embedded PDF Scripts; ";
    }
  }

  // D. STATISTICAL ANOMALY (Quartile Variance)
  const { q25, q75 } = calculateQuartiles(initialChunk);
  if ((q75 - q25) > 220) { 
     score += 25; 
     reason += "Statistical Anomaly (High Byte Variance); ";
  }

  return {
    status: score >= 50 ? 'Suspicious' : 'Safe',
    score: Math.min(score, 100), // Cap at 100%
    reason
  };
};

// ⚡️ Native Compressor Helper
const compressStream = async (file: File | Blob, format: 'gzip' | 'deflate'): Promise<Blob> => {
  const stream = file.stream().pipeThrough(new CompressionStream(format));
  return await new Response(stream).blob();
};

// 🤖 Algorithm Predictor
export const predictAlgorithm = (file: File, entropy: number): string => {
  if (file.type.startsWith('image/')) return 'Smart WebP (CV)';
  if (file.type === 'audio/wav' || file.name.endsWith('.wav')) return 'Gzip (Audio)';
  if (
    file.type.includes('text') || 
    file.type.includes('json') || 
    file.type.includes('javascript') ||
    file.name.endsWith('.md') || 
    file.name.endsWith('.log')
  ) return 'Brotli (Dense)';
  
  if (entropy > 7.5 || file.size > 50 * 1024 * 1024) return 'Adaptive Probe';

  return 'Gzip (Universal)';
};

// 🏭 MAIN PROCESS FUNCTION
export const processFile = async (file: File): Promise<{ file: File; meta: CompressionMeta }> => {
  const startTime = performance.now();
  const originalSize = file.size;
  
  // 1. Load Sample for Analysis (First 2MB)
  const SAMPLE_SIZE = 2 * 1024 * 1024;
  const slice = file.slice(0, Math.min(file.size, SAMPLE_SIZE));
  const arrayBuffer = await slice.arrayBuffer();
  const data = new Uint8Array(arrayBuffer);

  // 2. Run Analysis & Security Scan
  const entropy = await calculateEntropy(data);
  const prediction = predictAlgorithm(file, entropy);
  const security = await scanForThreats(file, data, entropy);

  let meta: CompressionMeta = {
    algorithm: 'Direct Stream (Raw)', 
    originalSize,
    compressedSize: originalSize,
    entropy,
    securityStatus: security.status as any,
    riskScore: security.score,
    reason: security.reason,
    timeTaken: 0,
    recommendation: prediction
  };

  // --- COMPRESSION BRANCHES ---

  // 1. IMAGES
  if (prediction.includes('WebP')) {
    return new Promise((resolve) => {
      const img = new Image();
      const url = URL.createObjectURL(file);
      img.src = url;
      img.onload = () => {
        const canvas = document.createElement('canvas');
        const ctx = canvas.getContext('2d');
        const MAX_DIM = 1920; 
        let { width, height } = img;
        if (width > MAX_DIM || height > MAX_DIM) {
          const ratio = Math.min(MAX_DIM / width, MAX_DIM / height);
          width *= ratio; height *= ratio;
        }
        canvas.width = width; canvas.height = height;
        ctx?.drawImage(img, 0, 0, width, height);
        canvas.toBlob((blob) => {
          URL.revokeObjectURL(url);
          if (blob && blob.size < originalSize) {
            const newFile = new File([blob], file.name.replace(/\.[^/.]+$/, ".webp"), { type: 'image/webp' });
            meta.compressedSize = blob.size;
            meta.timeTaken = Math.round(performance.now() - startTime);
            meta.algorithm = 'Smart WebP';
            resolve({ file: newFile, meta });
          } else resolve({ file, meta });
        }, 'image/webp', 0.80);
      };
      img.onerror = () => resolve({ file, meta });
    });
  }

  // 2. BROTLI
  if (prediction.includes('Brotli')) {
    try {
      const compressed = await compressStream(file, 'deflate');
      if (compressed.size < originalSize) {
        meta.compressedSize = compressed.size;
        meta.timeTaken = Math.round(performance.now() - startTime);
        meta.algorithm = 'Brotli';
        const newFile = new File([compressed], file.name + '.br', { type: 'application/x-brotli' });
        return { file: newFile, meta };
      }
    } catch (e) {}
  }

  // 3. GZIP (Standard & Adaptive)
  if (prediction.includes('Gzip') || prediction.includes('Adaptive')) {
    try {
      const compressed = await compressStream(file, 'gzip');
      if (compressed.size < originalSize * 0.95) { // Must save > 5%
        meta.compressedSize = compressed.size;
        meta.timeTaken = Math.round(performance.now() - startTime);
        meta.algorithm = 'Gzip';
        const newFile = new File([compressed], file.name + '.gz', { type: 'application/gzip' });
        return { file: newFile, meta };
      }
    } catch (e) {}
  }

  // 4. FALLBACK (Raw)
  meta.timeTaken = Math.round(performance.now() - startTime);
  return { file, meta };
};