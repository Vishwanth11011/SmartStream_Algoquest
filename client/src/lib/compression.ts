// client/src/lib/compression.ts

export interface CompressionMeta {
  algorithm: string;
  originalSize: number;
  compressedSize: number;
  entropy: number;
  timeTaken: number;
  recommendation: string;
}

// 🧠 Shannon Entropy Calculation (Remains the same for UI sync)
const calculateEntropy = async (file: Blob): Promise<number> => {
  const arrayBuffer = await file.arrayBuffer();
  const data = new Uint8Array(arrayBuffer);
  const frequencies = new Array(256).fill(0);
  for (let i = 0; i < data.length; i++) frequencies[data[i]]++;
  return frequencies.reduce((sum, count) => {
    if (count === 0) return sum;
    const p = count / data.length;
    return sum - p * Math.log2(p);
  }, 0);
};

// ⚡️ NEW: Generic Lossless Compression (Gzip)
const compressGeneric = async (file: File): Promise<Blob> => {
  const stream = file.stream().pipeThrough(new CompressionStream('gzip'));
  return await new Response(stream).blob();
};

export const predictAlgorithm = (file: File, entropy: number): string => {
  if (file.type.startsWith('image/')) return 'Smart WebP';
  // If entropy is high (> 7.8), it's likely already compressed (ZIP/MP4)
  if (entropy > 7.8) return 'AES-256 (Raw)';
  // Low entropy files get Gzip
  return 'GZIP (Lossless)';
};

export const processFile = async (file: File): Promise<{ file: File; meta: CompressionMeta }> => {
  const startTime = performance.now();
  const originalSize = file.size;
  const entropy = await calculateEntropy(file);
  const recommendation = predictAlgorithm(file, entropy);

  let meta: CompressionMeta = {
    algorithm: recommendation,
    originalSize,
    compressedSize: originalSize,
    entropy,
    timeTaken: 0,
    recommendation
  };

  // --- STRATEGY 1: Image Compression (Specialized) ---
  if (file.type.startsWith('image/')) {
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
            const newFile = new File([blob], file.name.replace(/\.[^/.]+$/, ".webp"), { type: 'image/webp' });
            meta.compressedSize = blob.size;
            meta.timeTaken = Math.round(performance.now() - startTime);
            resolve({ file: newFile, meta });
          } else resolve({ file, meta });
        }, 'image/webp', 0.8);
      };
    });
  }

  // --- STRATEGY 2: Generic Compression (For PDFs, Text, Code) ---
  if (recommendation.includes('GZIP')) {
    const compressedBlob = await compressGeneric(file);
    if (compressedBlob.size < originalSize) {
      meta.compressedSize = compressedBlob.size;
      meta.algorithm = 'GZIP Lossless';
      meta.timeTaken = Math.round(performance.now() - startTime);
      // We append .gz to let the receiver know it's compressed
      const compressedFile = new File([compressedBlob], `${file.name}.gz`, { type: 'application/gzip' });
      return { file: compressedFile, meta };
    }
  }

  // --- STRATEGY 3: High Entropy (Skip) ---
  meta.timeTaken = Math.round(performance.now() - startTime);
  return { file, meta };
};