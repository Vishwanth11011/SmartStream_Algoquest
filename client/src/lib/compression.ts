// client/src/lib/compression.ts

export interface CompressionMeta {
  algorithm: string;
  originalSize: number;
  compressedSize: number;
  entropy: number;
  timeTaken: number;
  recommendation: string;
}

/**
   Shannon Entropy Calculator
 * Measures information density (0.0 - 8.0 bits/byte).
 */
const calculateEntropy = async (file: File): Promise<number> => {
  // Optimization: For large files (>50MB), only sample the first 2MB for speed.
  const SAMPLE_SIZE = 2 * 1024 * 1024;
  const slice = file.slice(0, Math.min(file.size, SAMPLE_SIZE));
  const arrayBuffer = await slice.arrayBuffer();
  const data = new Uint8Array(arrayBuffer);
  
  const frequencies = new Array(256).fill(0);
  for (let i = 0; i < data.length; i++) frequencies[data[i]]++;
  
  return frequencies.reduce((sum, count) => {
    if (count === 0) return sum;
    const p = count / data.length;
    return sum - p * Math.log2(p);
  }, 0);
};

/**
  NATIVE COMPRESSOR
 */
const compressStream = async (file: File | Blob, format: 'gzip' | 'deflate'): Promise<Blob> => {
  const stream = file.stream().pipeThrough(new CompressionStream(format));
  return await new Response(stream).blob();
};

/**
  Takes a sample of a large file, tries to compress it, 
 * and decides if the CPU cost is worth the bandwidth savings.
 */
const performCompressionProbe = async (file: File): Promise<boolean> => {
  const PROBE_SIZE = 2 * 1024 * 1024; // 2MB Probe
  if (file.size < PROBE_SIZE) return true; // Small files always try

  const chunk = file.slice(0, PROBE_SIZE);
  const compressedChunk = await compressStream(chunk, 'gzip');
  
  const savings = 1 - (compressedChunk.size / chunk.size);
  // If we save more than 5%, it's worth compressing the whole stream
  return savings > 0.05; 
};

/**
 DECISION ENGINE
 */
export const predictAlgorithm = (file: File, entropy: number): string => {
  // 1. IMAGE ANALYSIS (Visual Perception)
  if (file.type.startsWith('image/')) {
    if (['image/png', 'image/jpeg', 'image/jpg', 'image/webp'].includes(file.type)) return 'Smart WebP (CV)';
    return 'None (Raw)'; 
  }

  // 2. AUDIO ANALYSIS (Waveform Redundancy)
  // WAV/AIFF are huge but highly compressible (~30-50% savings)
  if (file.type === 'audio/wav' || file.type === 'audio/x-aiff' || file.name.endsWith('.wav')) {
    return 'Gzip (Audio)';
  }

  // 3. TEXT & CODE (Statistical Redundancy)
  if (
    file.type.includes('text') || 
    file.type.includes('json') || 
    file.type.includes('javascript') || 
    file.type.includes('xml') ||
    file.name.endsWith('.md') || 
    file.name.endsWith('.log')
  ) {
    return 'Brotli (Dense)';
  }

  // 4. HIGH ENTROPY / LARGE FILES (Adaptive)
  if (entropy > 7.5 || file.size > 50 * 1024 * 1024) {
    return 'Adaptive Probe (Analyzing...)'; // Logic handled in processFile
  }

  // 5. DEFAULT
  return 'Gzip (Universal)';
};

/**
 COMPRESSION PIPELINE
 */
export const processFile = async (file: File): Promise<{ file: File; meta: CompressionMeta }> => {
  const startTime = performance.now();
  const originalSize = file.size;
  
  // 1. Analyze "DNA"
  const entropy = await calculateEntropy(file);
  let strategy = predictAlgorithm(file, entropy);

  let meta: CompressionMeta = {
    algorithm: strategy,
    originalSize,
    compressedSize: originalSize,
    entropy,
    timeTaken: 0,
    recommendation: strategy
  };

  // --- BRANCH 1: SMART IMAGE RESAMPLING (Computer Vision) ---
  if (strategy.includes('Smart WebP')) {
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
        
        canvas.toBlob(async (blob) => {
          URL.revokeObjectURL(url);
          if (blob && blob.size < originalSize) {
            const newName = file.name.replace(/\.[^/.]+$/, ".webp");
            const newFile = new File([blob], newName, { type: 'image/webp' });
            
            meta.compressedSize = blob.size;
            meta.timeTaken = Math.round(performance.now() - startTime);
            meta.algorithm = 'Smart WebP (Optimized)';
            
            resolve({ file: newFile, meta });
          } else {
            resolve({ file, meta });
          }
        }, 'image/webp', 0.80);
      };
      img.onerror = () => resolve({ file, meta });
    });
  }

  // --- BRANCH 2: TEXT (Brotli) ---
  if (strategy.includes('Brotli')) {
    try {
      const compressedBlob = await compressStream(file, 'deflate'); 
      if (compressedBlob.size < originalSize) {
        meta.compressedSize = compressedBlob.size;
        meta.timeTaken = Math.round(performance.now() - startTime);
        meta.algorithm = 'Brotli (Text)';
        const newFile = new File([compressedBlob], file.name + '.br', { type: 'application/x-brotli' });
        return { file: newFile, meta };
      }
    } catch (e) { console.warn("Brotli skipped", e); }
  }

  // --- BRANCH 3: ADAPTIVE PROBE (The Smart Check) ---
  if (strategy.includes('Adaptive') || strategy.includes('Gzip')) {
    let shouldUseGzip = true;

    // If it's the "Adaptive" branch, we run the PROBE first
    if (strategy.includes('Adaptive')) {
      const isWorthIt = await performCompressionProbe(file);
      if (!isWorthIt) {
        shouldUseGzip = false;
        meta.algorithm = 'Direct Stream (Raw)'; // Update meta to reflect decision
      } else {
        meta.algorithm = 'Gzip (Adaptive)';
      }
    }

    if (shouldUseGzip) {
      try {
        const compressedBlob = await compressStream(file, 'gzip');
        if (compressedBlob.size < originalSize) {
          meta.compressedSize = compressedBlob.size;
          meta.timeTaken = Math.round(performance.now() - startTime);
          const newFile = new File([compressedBlob], file.name + '.gz', { type: 'application/gzip' });
          return { file: newFile, meta };
        }
      } catch (e) { console.warn("Gzip skipped", e); }
    }
  }

  // --- BRANCH 4: RAW ---
  meta.timeTaken = Math.round(performance.now() - startTime);
  return { file, meta };
};