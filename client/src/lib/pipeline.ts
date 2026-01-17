import { encryptChunk, decryptChunk } from './crypto';

// --- HELPER FUNCTIONS ---
const compressStream = (stream: ReadableStream, algo: 'gzip' | 'deflate' = 'gzip') => {
  // @ts-ignore - TypeScript sometimes misses CompressionStream types in older setups
  return stream.pipeThrough(new CompressionStream(algo));
};

// --- SENDER PIPELINE ---
export const sendFilePipeline = async (
  file: File, 
  sharedKey: CryptoKey, 
  onChunk: (chunk: Uint8Array) => void
) => {
  console.log("🚀 Starting Pipeline for:", file.name);

  const fileStream = file.stream();
  const compressedStream = compressStream(fileStream, 'gzip');
  const reader = compressedStream.getReader();
  
  let totalBytesSent = 0;

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    // FIX 1: Explicitly cast 'value' to Uint8Array to fix red line
    const chunk = value as Uint8Array; 
    
    // Encrypt
    const encryptedChunk = await encryptChunk(sharedKey, chunk);

    // Send
    onChunk(encryptedChunk);
    
    totalBytesSent += chunk.length;
  }

  console.log(`✅ Pipeline Finished. Sent ${totalBytesSent} bytes.`);
  return totalBytesSent;
};

// --- RECEIVER PIPELINE ---
export class ReceiverPipeline {
  private writable: WritableStreamDefaultWriter;
  private readable: ReadableStream;
  private key: CryptoKey;

  constructor(key: CryptoKey, onComplete: (blob: Blob) => void) {
    this.key = key;

    const { writable, readable } = new TransformStream();
    this.writable = writable.getWriter();
    
    // @ts-ignore - TypeScript definition fix for DecompressionStream
    this.readable = readable.pipeThrough(new DecompressionStream('gzip'));

    this.readOutput(onComplete);
  }

  private async readOutput(onComplete: (blob: Blob) => void) {
    const reader = this.readable.getReader();
    const chunks: Uint8Array[] = [];

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      
      // FIX 2: Explicit casting here too
      chunks.push(value as Uint8Array);
    }

    const blob = new Blob(chunks);
    onComplete(blob);
  }

  async processChunk(encryptedChunk: Uint8Array) {
    try {
      const decryptedBuffer = await decryptChunk(this.key, encryptedChunk);
      
      // FIX 3: Ensure we write a Uint8Array
      await this.writable.write(new Uint8Array(decryptedBuffer));
    } catch (e) {
      console.error("❌ Decryption/Pipeline failed for chunk", e);
    }
  }

  async finish() {
    await this.writable.close();
  }
}