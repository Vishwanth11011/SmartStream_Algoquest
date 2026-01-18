// client/src/lib/pipeline.ts

import * as fzstd from 'fzstd';
import brotliPromise from 'brotli-wasm';
import * as lz4 from 'lz4js'; 
import * as SnappyJS from 'snappyjs';

let brotli: any = null;
async function initWasm() { if (!brotli) brotli = await brotliPromise; }

// --- HELPERS (Now return success flag) ---
async function compressChunk(chunk: Uint8Array, algo: string): Promise<{ data: Uint8Array, failed: boolean }> {
  if (!algo || algo === 'None') return { data: chunk, failed: false };
  await initWasm();
  try {
    let compressed: Uint8Array;
    switch (algo) {
      case 'Zstd': compressed = fzstd.compress(chunk); break;
      case 'Brotli': compressed = brotli.compress(chunk); break;
      case 'LZ4': compressed = lz4.compress(chunk); break;
      case 'Snappy': compressed = new Uint8Array(SnappyJS.compress(chunk.buffer)); break;
      case 'Gzip': 
        const stream = new CompressionStream('gzip');
        const writer = stream.writable.getWriter();
        writer.write(chunk);
        writer.close();
        compressed = new Uint8Array(await new Response(stream.readable).arrayBuffer());
        break;
      default: return { data: chunk, failed: false };
    }
    return { data: compressed, failed: false };
  } catch (e) { 
    return { data: chunk, failed: true }; // Flag as Bad Chunk
  }
}

async function decompressChunk(chunk: Uint8Array, algo: string): Promise<{ data: Uint8Array, failed: boolean }> {
  if (!algo || algo === 'None') return { data: chunk, failed: false };
  await initWasm();
  try {
    let decompressed: Uint8Array;
    switch (algo) {
      case 'Zstd': decompressed = fzstd.decompress(chunk); break;
      case 'Brotli': decompressed = brotli.decompress(chunk); break;
      case 'LZ4': decompressed = lz4.decompress(chunk); break;
      case 'Snappy': decompressed = new Uint8Array(SnappyJS.uncompress(chunk.buffer)); break;
      case 'Gzip':
        const stream = new DecompressionStream('gzip');
        const writer = stream.writable.getWriter();
        writer.write(chunk);
        writer.close();
        decompressed = new Uint8Array(await new Response(stream.readable).arrayBuffer());
        break;
      default: return { data: chunk, failed: false };
    }
    return { data: decompressed, failed: false };
  } catch (e) {
    return { data: chunk, failed: true }; // Flag as Bad Chunk (Fallback)
  }
}

// --- SENDER ---
export async function sendFilePipeline(
  file: File, key: CryptoKey, algo: string, 
  callback: (chunk: Uint8Array) => Promise<void>
) {
  const chunkSize = 64 * 1024; 
  let offset = 0;
  
  // 📊 STATS
  let originalSize = 0;
  let bandwidthUsed = 0;
  let badChunks = 0;
  const startTime = performance.now();

  console.log(`🚀 SENDER: Starting ${file.name} (${algo})`);

  while (offset < file.size) {
    const chunkBlob = file.slice(offset, offset + chunkSize);
    const buffer = await chunkBlob.arrayBuffer();
    const rawData = new Uint8Array(buffer);
    originalSize += rawData.byteLength;

    // 1. Compress
    const { data: compressedData, failed } = await compressChunk(rawData, algo);
    if (failed) badChunks++;

    // 2. Encrypt
    const iv = window.crypto.getRandomValues(new Uint8Array(12));
    const encrypted = await window.crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, compressedData);

    // 3. Pack
    const pkg = new Uint8Array(iv.byteLength + encrypted.byteLength);
    pkg.set(iv);
    pkg.set(new Uint8Array(encrypted), iv.byteLength);

    bandwidthUsed += pkg.byteLength; // Actual network usage

    await callback(pkg);
    offset += chunkSize;
  }

  const duration = ((performance.now() - startTime) / 1000).toFixed(2);
  console.log(`✅ SENDER STATS:
  - Original: ${(originalSize/1024/1024).toFixed(2)} MB
  - Sent: ${(bandwidthUsed/1024/1024).toFixed(2)} MB
  - Time: ${duration}s
  - Bad Chunks: ${badChunks}`);
  
  return { originalSize, bandwidthUsed, duration, badChunks };
}

// --- RECEIVER ---
export class ReceiverPipeline {
  private key: CryptoKey;
  private algo: string;
  private onComplete: (blob: Blob, stats: any) => void;
  private rawChunks: Uint8Array[] = [];
  
  // 📊 STATS
  private bandwidthReceived = 0;
  private startTime = 0;

  constructor(key: CryptoKey, algo: string, onComplete: (blob: Blob, stats: any) => void) {
    this.key = key;
    this.algo = algo;
    this.onComplete = onComplete;
    this.startTime = performance.now();
  }

  processChunk(pkg: Uint8Array) {
    this.bandwidthReceived += pkg.byteLength;
    this.rawChunks.push(pkg);
  }

  async finish() {
    console.log(`🏁 PROCESSING ${this.rawChunks.length} chunks...`);
    const finalData: Uint8Array[] = [];
    let badChunks = 0;
    let finalSize = 0;

    for (const pkg of this.rawChunks) {
      try {
        const iv = pkg.slice(0, 12);
        const data = pkg.slice(12);

        // Decrypt
        const decrypted = await window.crypto.subtle.decrypt({ name: 'AES-GCM', iv }, this.key, data);
        const compressedChunk = new Uint8Array(decrypted);

        // Decompress
        const { data: cleanChunk, failed } = await decompressChunk(compressedChunk, this.algo);
        if (failed) badChunks++;

        finalData.push(cleanChunk);
        finalSize += cleanChunk.byteLength;
      } catch (e) { 
        console.error("❌ Corrupt Chunk Dropped");
      }
    }

    const blob = new Blob(finalData);
    const duration = ((performance.now() - this.startTime) / 1000).toFixed(2);

    const stats = {
      received: this.bandwidthReceived,
      finalSize: finalSize,
      duration: duration,
      badChunks: badChunks
    };

    console.log(`✅ RECEIVER STATS:`, stats);
    
    this.rawChunks = []; 
    this.onComplete(blob, stats);
  }
}
//v1.2

// import { encryptChunk, decryptChunk } from './crypto';

// // --- HELPER FUNCTIONS ---
// const compressStream = (stream: ReadableStream, algo: 'gzip' | 'deflate' = 'gzip') => {
//   // @ts-ignore - TypeScript sometimes misses CompressionStream types in older setups
//   return stream.pipeThrough(new CompressionStream(algo));
// };

// // --- SENDER PIPELINE ---
// export const sendFilePipeline = async (
//   file: File, 
//   sharedKey: CryptoKey, 
//   onChunk: (chunk: Uint8Array) => void
// ) => {
//   console.log("🚀 Starting Pipeline for:", file.name);

//   const fileStream = file.stream();
//   const compressedStream = compressStream(fileStream, 'gzip');
//   const reader = compressedStream.getReader();
  
//   let totalBytesSent = 0;

//   while (true) {
//     const { done, value } = await reader.read();
//     if (done) break;

//     // FIX 1: Explicitly cast 'value' to Uint8Array to fix red line
//     const chunk = value as Uint8Array; 
    
//     // Encrypt
//     const encryptedChunk = await encryptChunk(sharedKey, chunk);

//     // Send
//     await onChunk(encryptedChunk);
    
//     totalBytesSent += chunk.length;
//   }

//   console.log(`✅ Pipeline Finished. Sent ${totalBytesSent} bytes.`);
//   return totalBytesSent;
// };


// export class ReceiverPipeline {
//   private key: CryptoKey;
//   private onComplete: (blob: Blob) => void;
//   private chunks: Uint8Array[] = [];
//   private totalSize: number = 0;

//   constructor(key: CryptoKey, onComplete: (blob: Blob) => void) {
//     this.key = key;
//     this.onComplete = onComplete; // ✅ Ensure this is stored!
//   }

//   async processChunk(encryptedChunk: Uint8Array) {
//     try {
//       // 1. Decrypt (AES-GCM)
//       // The IV is usually the first 12 bytes of the chunk (standard practice)
//       // If your sender logic prepends IV, use this:
//       const iv = encryptedChunk.slice(0, 12);
//       const data = encryptedChunk.slice(12);

//       const decrypted = await window.crypto.subtle.decrypt(
//         { name: 'AES-GCM', iv: iv },
//         this.key,
//         data
//       );

//       // 2. Store
//       const buffer = new Uint8Array(decrypted);
//       this.chunks.push(buffer);
//       this.totalSize += buffer.byteLength;
      
//     } catch (e) {
//       console.error("Decryption failed on chunk", e);
//     }
//   }

//   // ✅ The Manual Finish Trigger
//   finish() {
//     console.log(`⚠️ Force finishing pipeline... (Chunks: ${this.chunks.length})`);
    
//     if (this.chunks.length === 0) {
//       console.warn("⚠️ Warning: Pipeline finished with 0 chunks.");
//     }

//     // 1. Merge all chunks into one Blob
//     const blob = new Blob(this.chunks);
    
//     // 2. Clear memory
//     this.chunks = [];

//     // 3. TRIGGER THE UI UPDATE
//     if (this.onComplete) {
//       console.log("⚡ Executing onComplete callback...");
//       this.onComplete(blob);
//     } else {
//       console.error("❌ Critical: onComplete callback is missing!");
//     }
//   }
// }




//V1.1

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