import * as ort from 'onnxruntime-web';

// Load the model once
let session: ort.InferenceSession | null = null;

export const loadModel = async () => {
  try {
    session = await ort.InferenceSession.create('/model.onnx');
    console.log("AI Model Loaded");
  } catch (e) {
    console.error("Failed to load AI model. Using fallback logic.", e);
  }
};

// Calculate Shannon Entropy (The "Randomness" score)
const calculateEntropy = (buffer: Uint8Array): number => {
  const frequencies = new Array(256).fill(0);
  for (let i = 0; i < buffer.length; i++) {
    frequencies[buffer[i]]++;
  }

  return frequencies.reduce((sum, freq) => {
    if (freq === 0) return sum;
    const p = freq / buffer.length;
    return sum - p * Math.log2(p);
  }, 0);
};

export const analyzeFile = async (file: File) => {
  // 1. Read only the first 64KB (Fast scan)
  const CHUNK_SIZE = 64 * 1024;
  const buffer = await file.slice(0, CHUNK_SIZE).arrayBuffer();
  const uint8 = new Uint8Array(buffer);

  // 2. Extract Features
  const entropy = calculateEntropy(uint8);
  const sizeMB = file.size / (1024 * 1024);
  const isBinary = entropy > 3.0 ? 1 : 0; // Simple heuristic

  console.log(`File Analysis - Entropy: ${entropy.toFixed(2)}, Size: ${sizeMB.toFixed(2)}MB`);

  // 3. AI Prediction (or Fallback)
  if (session) {
    const input = new ort.Tensor('float32', Float32Array.from([entropy, sizeMB, isBinary]), [1, 3]);
    const feeds = { float_input: input };
    const results = await session.run(feeds);
    const output = results.label.data[0] as number; // 0, 1, or 2
    
    const algos = ['Brotli', 'Zstd', 'None'];
    return algos[output] || 'Zstd';
  } else {
    // Fallback if AI fails (Hackathon safety net)
    if (entropy < 4.5) return 'Brotli';
    if (entropy > 7.5) return 'None';
    return 'Zstd';
  }
};