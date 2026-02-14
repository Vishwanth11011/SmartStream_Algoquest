// client/src/lib/compression.ts

export interface CompressionMeta {
  algorithm: string;
  originalSize: number;
  compressedSize: number;
  entropy: number;
  timeTaken: number;
  recommendation: string;
}

//  Shannon Entropy (Unchanged)
const calculateEntropy = async (file: File): Promise<number> => {
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

//  Native Compressor
const compressStream = async (file: File | Blob, format: 'gzip' | 'deflate'): Promise<Blob> => {
  const stream = file.stream().pipeThrough(new CompressionStream(format));
  return await new Response(stream).blob();
};

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
  
  // High entropy / Large files -> Adaptive
  if (entropy > 7.5 || file.size > 50 * 1024 * 1024) return 'Adaptive Probe';

  return 'Gzip (Universal)';
};

export const processFile = async (file: File): Promise<{ file: File; meta: CompressionMeta }> => {
  const startTime = performance.now();
  const originalSize = file.size;
  const entropy = await calculateEntropy(file);
  const prediction = predictAlgorithm(file, entropy);

  let meta: CompressionMeta = {
    algorithm: 'Direct Stream (Raw)', // Default to Raw unless proven otherwise
    originalSize,
    compressedSize: originalSize,
    entropy,
    timeTaken: 0,
    recommendation: prediction
  };

  // --- 1. IMAGES ---
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
            meta.algorithm = 'Smart WebP'; // ✅ Success
            resolve({ file: newFile, meta });
          } else {
            resolve({ file, meta }); // Failed to shrink, send Raw
          }
        }, 'image/webp', 0.80);
      };
      img.onerror = () => resolve({ file, meta });
    });
  }

  // --- 2. BROTLI / DEFLATE ---
  if (prediction.includes('Brotli')) {
    try {
      const compressed = await compressStream(file, 'deflate');
      if (compressed.size < originalSize) {
        meta.compressedSize = compressed.size;
        meta.timeTaken = Math.round(performance.now() - startTime);
        meta.algorithm = 'Brotli'; // ✅ Success
        // Add .br extension explicitly
        const newFile = new File([compressed], file.name + '.br', { type: 'application/x-brotli' });
        return { file: newFile, meta };
      }
    } catch (e) {}
  }

  // --- 3. GZIP (Standard & Adaptive) ---
  if (prediction.includes('Gzip') || prediction.includes('Adaptive')) {
    try {
      const compressed = await compressStream(file, 'gzip');
      // Must save at least 5% to justify the CPU cost
      if (compressed.size < originalSize * 0.95) {
        meta.compressedSize = compressed.size;
        meta.timeTaken = Math.round(performance.now() - startTime);
        meta.algorithm = 'Gzip'; // ✅ Success
        // Add .gz extension explicitly
        const newFile = new File([compressed], file.name + '.gz', { type: 'application/gzip' });
        return { file: newFile, meta };
      }
    } catch (e) {}
  }

  // --- 4. FALLBACK ---
  meta.timeTaken = Math.round(performance.now() - startTime);
  // If we reach here, we send the ORIGINAL file with 'Direct Stream (Raw)' algo
  return { file, meta };
};