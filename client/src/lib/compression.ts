import { gzipSync, deflateSync } from 'fflate';

const CONFIG = {
  SAMPLE_SIZE: 512 * 1024,
  ENTROPY_CUTOFF: 7.4,
  TEXT_ENTROPY_MAX: 5.5,
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

const detectTrueType = (header: Uint8Array): string => {
  const hex = Array.from(header.slice(0, 8)).map(b => b.toString(16).padStart(2, '0')).join('').toUpperCase();
  if (hex.startsWith('FFD8FF')) return 'image/jpeg';
  if (hex.startsWith('89504E47')) return 'image/png';
  if (hex.startsWith('25504446')) return 'application/pdf';
  if (hex.startsWith('504B0304')) return 'application/zip';
  return 'unknown/binary';
};

export const processFile = async (file: File): Promise<{ file: Blob, meta: FileMeta }> => {
  const buffer = await file.arrayBuffer();
  const rawData = new Uint8Array(buffer);
  
  const sample = rawData.slice(0, CONFIG.SAMPLE_SIZE);
  const entropy = calculateEntropy(sample);
  const trueType = detectTrueType(sample);
  
  // ✅ FIX: Use 'any' to stop TypeScript from fighting over ArrayBuffer vs SharedArrayBuffer
  let processedData: any = rawData;
  let algorithm = 'Store (No-Op)';
  let securityStatus: 'Safe' | 'Suspicious' = 'Safe';
  let riskScore = 0;
  let reason = 'Standard File';

  if ((file.name.endsWith('.txt') || file.name.endsWith('.js')) && entropy > CONFIG.RANSOMWARE_THRESHOLD) {
    securityStatus = 'Suspicious';
    riskScore = 95;
    reason = 'Abnormal Entropy (Potential Encrypted Payload)';
  }

  if (entropy > CONFIG.ENTROPY_CUTOFF || trueType.startsWith('image')) {
    algorithm = 'Store (Passthrough)';
  } else if (entropy < CONFIG.TEXT_ENTROPY_MAX || trueType.includes('json') || file.type.includes('text')) {
    try {
      algorithm = 'Deflate (Ultra)';
      processedData = deflateSync(rawData, { level: 9 });
    } catch (e) { console.warn("Compression failed", e); }
  } else {
    try {
      algorithm = 'Gzip (Standard)';
      processedData = gzipSync(rawData, { level: 6 });
    } catch (e) {}
  }

  if (processedData.length >= rawData.length) {
    algorithm = 'Store (Optimization)';
    processedData = rawData;
  }

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