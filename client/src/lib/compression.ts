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

  // --- ENHANCED SECURITY CHECK (Malware Detection) ---

  // 1. CHECK FOR DANGEROUS EXECUTABLE EXTENSIONS
  const dangerousExtensions = ['.exe', '.dll', '.sys', '.scr', '.bat', '.cmd', '.com', '.msi', '.sh', '.bash', '.zsh', '.ps1', '.psd1', '.psm1', '.psc1', '.jar', '.app', '.dmg', '.ipa'];
  const fileExtension = file.name.toLowerCase().match(/\.\w+$/)?.[0] || '';

  // 0. ZIP EXEMPTION (Skip compression for already compressed files)
  if (fileExtension === '.zip') {
    return {
      file,
      meta: {
        algorithm: 'Store (No-Op)',
        originalSize: file.size,
        compressedSize: file.size,
        entropy: 0,
        securityStatus: 'Safe',
        riskScore: 0,
        reason: 'Zip File (Skipped Compression)',
        mimeType: 'application/zip'
      }
    };
  }

  if (dangerousExtensions.includes(fileExtension)) {
    securityStatus = 'Suspicious';
    riskScore = 98;
    reason = `Blocked: Executable file type (${fileExtension})`;
  }

  // 2. CHECK FOR FILE TYPE MISMATCH (e.g., .exe disguised as .txt)
  const headerSignatures: Record<string, string[]> = {
    'MZ': ['.exe', '.dll', '.sys', '.scr', '.msi', '.com'], // Windows executable
    '\x7fELF': ['.so', '.bin'], // ELF header (Linux/Unix executable)
    'PK': ['.zip', '.jar', '.docx', '.xlsx', '.apk'], // Zip-based files
  };

  const headerStr = new TextDecoder().decode(sample.slice(0, 4));
  for (const [sig, validExts] of Object.entries(headerSignatures)) {
    if (headerStr.startsWith(sig) && !validExts.includes(fileExtension)) {
      securityStatus = 'Suspicious';
      riskScore = 99;
      reason = `Blocked: File type mismatch - Header indicates ${sig} but extension is ${fileExtension}`;
    }
  }

  // 3. CHECK FOR ABNORMAL ENTROPY (Encrypted/Packed Malware)
  // Only apply abnormal entropy block to text/code files, not to binary/document types
  const textExtensions = ['.txt', '.js', '.json', '.ipynb', '.xml', '.csv', '.md', '.html', '.css'];
  if (textExtensions.some(ext => file.name.endsWith(ext))) {
    if (entropy > 7.8 && !['DEFLATE_ZIP', 'LZMA_7Z', 'DCT_JPEG', 'DCT_VIDEO', 'ZSTD', 'AUDIO_MP3', 'AUDIO_FLAC'].includes(family)) {
      securityStatus = 'Suspicious';
      riskScore = 92;
      reason = 'Blocked: Abnormal entropy detected (possible packed/encrypted malware)';
    }
  }

  // 4. CHECK FOR TEXT FILES WITH SUSPICIOUS PATTERNS
  if ((file.name.endsWith('.txt') || file.name.endsWith('.js') || file.name.endsWith('.json') || file.name.endsWith('.ipynb')) && entropy > CONFIG.RANSOMWARE_THRESHOLD) {
    securityStatus = 'Suspicious';
    riskScore = 90;
    reason = 'Blocked: Abnormal Entropy in Text/Code (Potential Encrypted Payload)';
  }

  // 5. CHECK FOR DOUBLE EXTENSIONS (e.g., document.pdf.exe)
  const nameParts = file.name.split('.');
  if (nameParts.length > 2) {
    const lastExt = '.' + nameParts[nameParts.length - 1].toLowerCase();
    if (dangerousExtensions.includes(lastExt)) {
      securityStatus = 'Suspicious';
      riskScore = 97;
      reason = `Blocked: Suspicious double extension detected (${file.name})`;
    }
  }

  // 6. CHECK FOR SCRIPT INJECTION PATTERNS
  const scriptPatterns = ['script>', 'javascript:', 'onerror=', 'onload=', 'eval(', 'exec(', 'system(', 'WScript.Shell'];
  const fileContent = new TextDecoder().decode(sample.slice(0, Math.min(10000, sample.length)));
  if (scriptPatterns.some(pattern => fileContent.toLowerCase().includes(pattern.toLowerCase()))) {
    if (file.name.endsWith('.html') || file.name.endsWith('.htm')) {
      securityStatus = 'Suspicious';
      riskScore = 88;
      reason = 'Blocked: Potential malicious script injection detected in HTML file';
    }
  }

  // --- HEURISTIC SELECTION (FORCED COMPRESSION) ---

  // STRATEGY 1: TEXT & DATA -> DEFLATE (Ultra)
  // Text, JSON, Code, XML, SVGs compress best with raw DEFLATE at high levels.
  if (family === 'TEXT_DATA' || file.type.includes('text') || file.name.endsWith('.json') || file.name.endsWith('.js') || file.name.endsWith('.ipynb')) {
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