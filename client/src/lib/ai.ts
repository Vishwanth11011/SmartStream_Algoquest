// client/src/lib/ai.ts

// ... (calculateFeatures function remains the same) ...
function calculateFeatures(data: Uint8Array) {
  const frequencies = new Array(256).fill(0);
  for (const byte of data) frequencies[byte]++;

  // Calculate Shannon Entropy
  const entropy = frequencies.reduce((sum, freq) => {
    if (freq === 0) return sum;
    const p = freq / data.length;
    return sum - p * Math.log2(p);
  }, 0);

  return { entropy };
}

export async function analyzeFile(file: File): Promise<string> {
  const startTime = performance.now();
  
  // 1. FAST PATH REMOVED: Force analysis on ALL files
  /* const SKIP_EXTENSIONS = new Set(['mp4', 'mkv', 'avi', 'mov', 'webm', 'jpg', 'jpeg', 'png', 'zip', 'rar', '7z', 'gz', 'mp3']);
  const ext = file.name.split('.').pop()?.toLowerCase() || '';
  
  if (SKIP_EXTENSIONS.has(ext)) {
    return 'None';
  }
  */

  // 2. DEEP PATH: Content Analysis (First 16KB Sample)
  const sampleSize = Math.min(file.size, 16 * 1024); 
  const buffer = await file.slice(0, sampleSize).arrayBuffer();
  const data = new Uint8Array(buffer);

  const { entropy } = calculateFeatures(data);
  const inferenceTime = (performance.now() - startTime).toFixed(2);

  // 3. FORCED LOGIC
  // Even if entropy is high (random), we default to 'Gzip' to try and squeeze 
  // out any remaining patterns (like metadata headers in MP4s).
  let recommendation = 'Gzip'; 

  // Special Handling: PDFs often benefit from Brotli despite high entropy
  const ext = file.name.split('.').pop()?.toLowerCase();
  if (ext === 'pdf') {
     recommendation = 'Brotli';
  }
  // Standard Logic (Modified to be aggressive)
  else if (entropy < 6.0) {
     recommendation = 'Brotli'; // Text/Code/Logs -> Aggressive Compression
  } else {
     recommendation = 'Gzip';   // Video/Images -> Fast Compression
  }

  // 4. Console Output
  console.group(`🧠 AI Analysis Report: ${file.name}`);
  console.log(`📊 Entropy Score:  ${entropy.toFixed(4)} / 8.0000`);
  console.log(`⏱️ Inference Time: ${inferenceTime}ms`);
  console.log(`📂 File Type:      ${file.type || 'Unknown'}`);
  console.log(`🤖 AI Recommendation: %c${recommendation.toUpperCase()}`, 'color: #22D3EE; font-weight: bold;');
  console.groupEnd();

  return recommendation;
}