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
    await onChunk(encryptedChunk);
    
    totalBytesSent += chunk.length;
  }

  console.log(`✅ Pipeline Finished. Sent ${totalBytesSent} bytes.`);
  return totalBytesSent;
};


export class ReceiverPipeline {
  private key: CryptoKey;
  private onComplete: (blob: Blob) => void;
  private chunks: Uint8Array[] = [];
  private totalSize: number = 0;

  constructor(key: CryptoKey, onComplete: (blob: Blob) => void) {
    this.key = key;
    this.onComplete = onComplete; // ✅ Ensure this is stored!
  }

  async processChunk(encryptedChunk: Uint8Array) {
    try {
      // 1. Decrypt (AES-GCM)
      // The IV is usually the first 12 bytes of the chunk (standard practice)
      // If your sender logic prepends IV, use this:
      const iv = encryptedChunk.slice(0, 12);
      const data = encryptedChunk.slice(12);

      const decrypted = await window.crypto.subtle.decrypt(
        { name: 'AES-GCM', iv: iv },
        this.key,
        data
      );

      // 2. Store
      const buffer = new Uint8Array(decrypted);
      this.chunks.push(buffer);
      this.totalSize += buffer.byteLength;
      
    } catch (e) {
      console.error("Decryption failed on chunk", e);
    }
  }

  // ✅ The Manual Finish Trigger
  finish() {
    console.log(`⚠️ Force finishing pipeline... (Chunks: ${this.chunks.length})`);
    
    if (this.chunks.length === 0) {
      console.warn("⚠️ Warning: Pipeline finished with 0 chunks.");
    }

    // 1. Merge all chunks into one Blob
    const blob = new Blob(this.chunks);
    
    // 2. Clear memory
    this.chunks = [];

    // 3. TRIGGER THE UI UPDATE
    if (this.onComplete) {
      console.log("⚡ Executing onComplete callback...");
      this.onComplete(blob);
    } else {
      console.error("❌ Critical: onComplete callback is missing!");
    }
  }
}




// // --- RECEIVER PIPELINE ---
// export class ReceiverPipeline {
//   private writable: WritableStreamDefaultWriter;
//   private readable: ReadableStream;
//   private key: CryptoKey;

//   constructor(key: CryptoKey, onComplete: (blob: Blob) => void) {
//     this.key = key;

//     const { writable, readable } = new TransformStream();
//     this.writable = writable.getWriter();
    
//     // @ts-ignore - TypeScript definition fix for DecompressionStream
//     this.readable = readable.pipeThrough(new DecompressionStream('gzip'));

//     this.readOutput(onComplete);
//   }

//   private async readOutput(onComplete: (blob: Blob) => void) {
//     const reader = this.readable.getReader();
//     const chunks: Uint8Array[] = [];

//     while (true) {
//       const { done, value } = await reader.read();
//       if (done) break;
      
//       // FIX 2: Explicit casting here too
//       chunks.push(value as Uint8Array);
//     }

//     const blob = new Blob(chunks);
//     onComplete(blob);
//   }

//   async processChunk(encryptedChunk: Uint8Array) {
//     try {
//       const decryptedBuffer = await decryptChunk(this.key, encryptedChunk);
      
//       // FIX 3: Ensure we write a Uint8Array
//       await this.writable.write(new Uint8Array(decryptedBuffer));
//     } catch (e) {
//       console.error("❌ Decryption/Pipeline failed for chunk", e);
//     }
//   }

//   finish() {
//     console.log("⚠️ Force finishing pipeline...");
//     // Combine all chunks received so far
//     const blob = new Blob(this.chunks);
    
//     // Clear memory
//     this.chunks = []; 
    
//     // Trigger the save callback manually
//     if (this.onComplete) {
//       this.onComplete(blob);
//     }
//   }
// }