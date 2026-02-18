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
  // Use only Gzip and Deflate since browser's DecompressionStream only supports these formats
  // Brotli is NOT supported by the browser API, so we always use Gzip
  let recommendation = 'Gzip'; 

  // Special Handling: Text/Code with low entropy can use Deflate for better compression
  if (entropy < 6.0) {
     recommendation = 'Deflate'; // Text/Code/Logs -> Better compression ratio
  } else {
     recommendation = 'Gzip';    // PDFs/Videos/Images -> Fast, compatible compression
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