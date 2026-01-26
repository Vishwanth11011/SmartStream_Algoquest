// client/src/lib/pipeline.ts
import imageCompression from 'browser-image-compression';

// ==========================================
// 🧠 SMART CONFIGURATION
// ==========================================
const CHUNK_SIZE = 1024 * 1024; // 1MB (Optimal for Local & Internet speed)

// Files that are ALREADY compressed. Re-compressing these wastes CPU.
const ALREADY_COMPRESSED = new Set([
  'mp4', 'mkv', 'avi', 'mov', 'webm', // Video
  'jpg', 'jpeg', 'png', 'gif', 'webp', // Image
  'zip', 'rar', '7z', 'gz', 'mp3', 'aac' // Archives/Audio
]);

// ==========================================
// 🛠️ HELPER ENGINES
// ==========================================

// 1. IMAGE OPTIMIZER (The "Hackathon Winner" Feature)
// Converts heavy PNG/JPGs to efficient WebP format.
async function optimizeImage(file: File): Promise<File> {
  try {
    const options = {
      maxSizeMB: 1,           // Target size ~1MB
      maxWidthOrHeight: 1920, // 1080p Resolution
      useWebWorker: true,     // Run in background thread
      fileType: 'image/webp'  // Next-Gen format
    };
    const compressedFile = await imageCompression(file, options);
    return compressedFile;
  } catch (e) {
    // If optimization fails, silently return original file
    return file; 
  }
}

// 2. NATIVE GZIP COMPRESSOR (Browser C++ Engine)
async function compressChunk(chunk: Uint8Array): Promise<{ data: Uint8Array, failed: boolean }> {
  try {
    const stream = new CompressionStream('gzip');
    const writer = stream.writable.getWriter();
    writer.write(chunk);
    writer.close();
    
    const result = await new Response(stream.readable).arrayBuffer();
    return { data: new Uint8Array(result), failed: false };
  } catch (e) {
    // Fallback to raw data if compression fails
    return { data: chunk, failed: true };
  }
}

// 3. NATIVE GZIP DECOMPRESSOR
async function decompressChunk(chunk: Uint8Array): Promise<{ data: Uint8Array, failed: boolean }> {
  try {
    const stream = new DecompressionStream('gzip');
    const writer = stream.writable.getWriter();
    writer.write(chunk);
    writer.close();

    const result = await new Response(stream.readable).arrayBuffer();
    return { data: new Uint8Array(result), failed: false };
  } catch (e) {
    console.warn("⚠️ Decompression failed. Using Raw fallback.");
    return { data: chunk, failed: true };
  }
}

// ==========================================
// 🚀 SENDER PIPELINE
// ==========================================
export async function sendFilePipeline(
  originalFile: File, 
  key: CryptoKey, 
  aiSuggestion: string, // The suggestion from your ai.ts
  callback: (chunk: Uint8Array) => Promise<void>
) {
  let fileToSend = originalFile;
  let finalAlgo = 'None';

  console.log(`🚀 PIPELINE START: ${originalFile.name} (AI Said: ${aiSuggestion})`);

  // --- STEP 1: APPLY SMART STRATEGY ---
  
  const ext = originalFile.name.split('.').pop()?.toLowerCase() || '';

  // A. MEDIA OPTIMIZATION (Images)
  if (originalFile.type.startsWith('image/') && !ALREADY_COMPRESSED.has(ext)) {
    console.log("🎨 Strategy: Smart Image Optimization (WebP)");
    fileToSend = await optimizeImage(originalFile);
    console.log(`📉 Size Reduced: ${(originalFile.size/1024).toFixed(0)}KB -> ${(fileToSend.size/1024).toFixed(0)}KB`);
    finalAlgo = 'None'; // It's already optimized, don't Gzip it!
  }
  // B. MEDIA BYPASS (Video/Zip)
  else if (ALREADY_COMPRESSED.has(ext)) {
    console.log("⏩ Strategy: Direct Stream (Max Speed)");
    finalAlgo = 'None';
  }
  // C. TEXT/DATA COMPRESSION (Everything else)
  else {
    // Trust the AI logic from ai.ts (Silesia Distilled Model)
    // If AI said Gzip, we use Gzip.
    if (aiSuggestion === 'Gzip') {
      console.log("📦 Strategy: Native Gzip Compression");
      finalAlgo = 'Gzip';
    } else {
      finalAlgo = 'None';
    }
  }

  // --- STEP 2: TRANSFER LOOP ---
  
  let offset = 0;
  let bandwidthUsed = 0;
  let badChunks = 0;
  const startTime = performance.now();

  while (offset < fileToSend.size) {
    const chunkBlob = fileToSend.slice(offset, offset + CHUNK_SIZE);
    const buffer = await chunkBlob.arrayBuffer();
    let data = new Uint8Array(buffer);

    // 1. Compress (if strategy is Gzip)
    if (finalAlgo === 'Gzip') {
      const { data: compressed, failed } = await compressChunk(data);
      if (failed) badChunks++;
      else data = compressed;
    }

    // 2. Encrypt (Always)
    const iv = window.crypto.getRandomValues(new Uint8Array(12));
    const encrypted = await window.crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, data);

    // 3. Pack (IV + Data)
    const pkg = new Uint8Array(iv.byteLength + encrypted.byteLength);
    pkg.set(iv);
    pkg.set(new Uint8Array(encrypted), iv.byteLength);

    bandwidthUsed += pkg.byteLength;

    // 4. Send
    await callback(pkg);
    offset += CHUNK_SIZE;
  }

  const duration = ((performance.now() - startTime) / 1000).toFixed(2);
  const speed = (fileToSend.size / 1024 / 1024 / parseFloat(duration)).toFixed(2);

  console.log(`✅ SENDER DONE. Speed: ${speed} MB/s | Algo Used: ${finalAlgo}`);

  // Return Telemetry for Dashboard
  return { 
    originalSize: originalFile.size,
    finalSize: bandwidthUsed,
    duration,
    speed,
    badChunks,
    algo: finalAlgo
  };
}

// ==========================================
// 📥 RECEIVER PIPELINE (Store-Then-Process)
// ==========================================
export class ReceiverPipeline {
  private key: CryptoKey;
  private algo: string;
  private onComplete: (blob: Blob, stats: any) => void;
  private rawChunks: Uint8Array[] = [];
  
  // Stats
  private bandwidthReceived = 0;
  private startTime = 0;

  constructor(key: CryptoKey, algo: string, onComplete: (blob: Blob, stats: any) => void) {
    this.key = key;
    this.algo = algo;
    this.onComplete = onComplete;
    this.startTime = performance.now();
  }

  // 1. Buffer incoming data (Fastest)
  processChunk(pkg: Uint8Array) {
    this.bandwidthReceived += pkg.byteLength;
    this.rawChunks.push(pkg);
  }

  // 2. Process all at once (Safest)
  async finish() {
    console.log(`🏁 PROCESSING ${this.rawChunks.length} chunks...`);
    const finalData: Uint8Array[] = [];
    let badChunks = 0;
    let finalSize = 0;

    for (const pkg of this.rawChunks) {
      try {
        const iv = pkg.slice(0, 12);
        const data = pkg.slice(12);

        // A. Decrypt
        const decrypted = await window.crypto.subtle.decrypt({ name: 'AES-GCM', iv }, this.key, data);
        let chunk = new Uint8Array(decrypted);

        // B. Decompress (if needed)
        if (this.algo === 'Gzip') {
          const { data: cleanChunk, failed } = await decompressChunk(chunk);
          if (failed) badChunks++;
          chunk = cleanChunk;
        }

        finalData.push(chunk);
        finalSize += chunk.byteLength;
      } catch (e) { 
        console.error("❌ Corrupt Chunk Dropped (Network/Crypto Error)");
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
    
    // Clear RAM
    this.rawChunks = []; 
    
    this.onComplete(blob, stats);
  }
}



// //v1.4
// import imageCompression from 'browser-image-compression';

// const CHUNK_SIZE = 1024 * 1024; // 1MB for speed

// // --- IMAGE OPTIMIZER ---
// async function optimizeImage(file: File): Promise<File> {
//   try {
//     const options = { maxSizeMB: 1, maxWidthOrHeight: 1920, useWebWorker: true, fileType: 'image/webp' };
//     return await imageCompression(file, options);
//   } catch (e) { return file; }
// }

// // --- NATIVE COMPRESSOR ---
// async function compressChunk(chunk: Uint8Array): Promise<Uint8Array> {
//   try {
//     const stream = new CompressionStream('gzip');
//     const writer = stream.writable.getWriter();
//     writer.write(chunk);
//     writer.close();
//     return new Uint8Array(await new Response(stream.readable).arrayBuffer());
//   } catch (e) { return chunk; }
// }

// // --- NATIVE DECOMPRESSOR ---
// async function decompressChunk(chunk: Uint8Array): Promise<Uint8Array> {
//   try {
//     const stream = new DecompressionStream('gzip');
//     const writer = stream.writable.getWriter();
//     writer.write(chunk);
//     writer.close();
//     return new Uint8Array(await new Response(stream.readable).arrayBuffer());
//   } catch (e) { return chunk; }
// }

// // --- SENDER PIPELINE ---
// export async function sendFilePipeline(
//   originalFile: File, key: CryptoKey, algo: string, 
//   callback: (chunk: Uint8Array) => Promise<void>
// ) {
//   let fileToSend = originalFile;
//   let finalAlgo = algo;

//   console.log(`🚀 PIPELINE: Starting with strategy [${algo}]`);

//   // 1. EXECUTE AI STRATEGY
//   if (algo === 'WebP') {
//     console.log("🎨 AI Strategy: Transcoding Image to WebP...");
//     fileToSend = await optimizeImage(originalFile);
//     console.log(`📉 Size Reduced: ${(originalFile.size/1024).toFixed(0)}KB -> ${(fileToSend.size/1024).toFixed(0)}KB`);
//     finalAlgo = 'None'; // It's now optimized, just send it raw
//   }

//   // 2. TRANSFER LOOP
//   let offset = 0;
//   // Stats for Dashboard
//   let originalSize = fileToSend.size; 
//   let bandwidthUsed = 0;
//   const startTime = performance.now();

//   while (offset < fileToSend.size) {
//     const chunkBlob = fileToSend.slice(offset, offset + CHUNK_SIZE);
//     const buffer = await chunkBlob.arrayBuffer();
//     let data = new Uint8Array(buffer);

//     // Compress only if AI said 'Gzip'
//     if (finalAlgo === 'Gzip') {
//       data = await compressChunk(data);
//     }

//     // Encrypt
//     const iv = window.crypto.getRandomValues(new Uint8Array(12));
//     const encrypted = await window.crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, data);

//     const pkg = new Uint8Array(iv.byteLength + encrypted.byteLength);
//     pkg.set(iv);
//     pkg.set(new Uint8Array(encrypted), iv.byteLength);

//     bandwidthUsed += pkg.byteLength;
//     await callback(pkg);
//     offset += CHUNK_SIZE;
//   }

//   const duration = ((performance.now() - startTime) / 1000).toFixed(2);
//   // Calculate Speed (MB/s)
//   const speed = (originalSize / 1024 / 1024 / parseFloat(duration)).toFixed(2);
  
//   return { 
//     originalSize: originalFile.size, // Show user the TRUE original size
//     finalSize: bandwidthUsed,        // Show what we actually sent
//     duration, 
//     speed,
//     algo: algo // Return the AI's choice to display
//   };
// }

// // --- RECEIVER PIPELINE (Unchanged Store-Then-Process) ---
// export class ReceiverPipeline {
//   private key: CryptoKey;
//   private algo: string;
//   private onComplete: (blob: Blob) => void;
//   private rawChunks: Uint8Array[] = [];

//   constructor(key: CryptoKey, algo: string, onComplete: (blob: Blob) => void) {
//     this.key = key;
//     this.algo = algo;
//     this.onComplete = onComplete;
//   }

//   processChunk(pkg: Uint8Array) {
//     this.rawChunks.push(pkg);
//   }

//   async finish() {
//     console.log("🏁 Reassembling...");
//     const finalData: Uint8Array[] = [];

//     for (const pkg of this.rawChunks) {
//       try {
//         const iv = pkg.slice(0, 12);
//         const data = pkg.slice(12);

//         const decrypted = await window.crypto.subtle.decrypt({ name: 'AES-GCM', iv }, this.key, data);
//         let chunk = new Uint8Array(decrypted);

//         if (this.algo === 'Gzip') {
//           chunk = await decompressChunk(chunk);
//         }
//         finalData.push(chunk);
//       } catch (e) { console.error("Chunk Error"); }
//     }

//     const blob = new Blob(finalData);
//     this.onComplete(blob);
//     this.rawChunks = [];
//   }
// }


//v1.3
// import * as fzstd from 'fzstd';
// import brotliPromise from 'brotli-wasm';
// import * as lz4 from 'lz4js'; 
// import * as SnappyJS from 'snappyjs';

// let brotli: any = null;
// async function initWasm() { if (!brotli) brotli = await brotliPromise; }

// // --- HELPERS (Now return success flag) ---
// async function compressChunk(chunk: Uint8Array, algo: string): Promise<{ data: Uint8Array, failed: boolean }> {
//   if (!algo || algo === 'None') return { data: chunk, failed: false };
//   await initWasm();
//   try {
//     let compressed: Uint8Array;
//     switch (algo) {
//       case 'Zstd': compressed = fzstd.compress(chunk); break;
//       case 'Brotli': compressed = brotli.compress(chunk); break;
//       case 'LZ4': compressed = lz4.compress(chunk); break;
//       case 'Snappy': compressed = new Uint8Array(SnappyJS.compress(chunk.buffer)); break;
//       case 'Gzip': 
//         const stream = new CompressionStream('gzip');
//         const writer = stream.writable.getWriter();
//         writer.write(chunk);
//         writer.close();
//         compressed = new Uint8Array(await new Response(stream.readable).arrayBuffer());
//         break;
//       default: return { data: chunk, failed: false };
//     }
//     return { data: compressed, failed: false };
//   } catch (e) { 
//     return { data: chunk, failed: true }; // Flag as Bad Chunk
//   }
// }

// async function decompressChunk(chunk: Uint8Array, algo: string): Promise<{ data: Uint8Array, failed: boolean }> {
//   if (!algo || algo === 'None') return { data: chunk, failed: false };
//   await initWasm();
//   try {
//     let decompressed: Uint8Array;
//     switch (algo) {
//       case 'Zstd': decompressed = fzstd.decompress(chunk); break;
//       case 'Brotli': decompressed = brotli.decompress(chunk); break;
//       case 'LZ4': decompressed = lz4.decompress(chunk); break;
//       case 'Snappy': decompressed = new Uint8Array(SnappyJS.uncompress(chunk.buffer)); break;
//       case 'Gzip':
//         const stream = new DecompressionStream('gzip');
//         const writer = stream.writable.getWriter();
//         writer.write(chunk);
//         writer.close();
//         decompressed = new Uint8Array(await new Response(stream.readable).arrayBuffer());
//         break;
//       default: return { data: chunk, failed: false };
//     }
//     return { data: decompressed, failed: false };
//   } catch (e) {
//     return { data: chunk, failed: true }; // Flag as Bad Chunk (Fallback)
//   }
// }

// // --- SENDER ---
// export async function sendFilePipeline(
//   file: File, key: CryptoKey, algo: string, 
//   callback: (chunk: Uint8Array) => Promise<void>
// ) {
//   const chunkSize = 64 * 1024; 
//   let offset = 0;
  
//   // 📊 STATS
//   let originalSize = 0;
//   let bandwidthUsed = 0;
//   let badChunks = 0;
//   const startTime = performance.now();

//   console.log(`🚀 SENDER: Starting ${file.name} (${algo})`);

//   while (offset < file.size) {
//     const chunkBlob = file.slice(offset, offset + chunkSize);
//     const buffer = await chunkBlob.arrayBuffer();
//     const rawData = new Uint8Array(buffer);
//     originalSize += rawData.byteLength;

//     // 1. Compress
//     const { data: compressedData, failed } = await compressChunk(rawData, algo);
//     if (failed) badChunks++;

//     // 2. Encrypt
//     const iv = window.crypto.getRandomValues(new Uint8Array(12));
//     const encrypted = await window.crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, compressedData);

//     // 3. Pack
//     const pkg = new Uint8Array(iv.byteLength + encrypted.byteLength);
//     pkg.set(iv);
//     pkg.set(new Uint8Array(encrypted), iv.byteLength);

//     bandwidthUsed += pkg.byteLength; // Actual network usage

//     await callback(pkg);
//     offset += chunkSize;
//   }

//   const duration = ((performance.now() - startTime) / 1000).toFixed(2);
//   console.log(`✅ SENDER STATS:
//   - Original: ${(originalSize/1024/1024).toFixed(2)} MB
//   - Sent: ${(bandwidthUsed/1024/1024).toFixed(2)} MB
//   - Time: ${duration}s
//   - Bad Chunks: ${badChunks}`);
  
//   return { originalSize, bandwidthUsed, duration, badChunks };
// }

// // --- RECEIVER ---
// export class ReceiverPipeline {
//   private key: CryptoKey;
//   private algo: string;
//   private onComplete: (blob: Blob, stats: any) => void;
//   private rawChunks: Uint8Array[] = [];
  
//   // 📊 STATS
//   private bandwidthReceived = 0;
//   private startTime = 0;

//   constructor(key: CryptoKey, algo: string, onComplete: (blob: Blob, stats: any) => void) {
//     this.key = key;
//     this.algo = algo;
//     this.onComplete = onComplete;
//     this.startTime = performance.now();
//   }

//   processChunk(pkg: Uint8Array) {
//     this.bandwidthReceived += pkg.byteLength;
//     this.rawChunks.push(pkg);
//   }

//   async finish() {
//     console.log(`🏁 PROCESSING ${this.rawChunks.length} chunks...`);
//     const finalData: Uint8Array[] = [];
//     let badChunks = 0;
//     let finalSize = 0;

//     for (const pkg of this.rawChunks) {
//       try {
//         const iv = pkg.slice(0, 12);
//         const data = pkg.slice(12);

//         // Decrypt
//         const decrypted = await window.crypto.subtle.decrypt({ name: 'AES-GCM', iv }, this.key, data);
//         const compressedChunk = new Uint8Array(decrypted);

//         // Decompress
//         const { data: cleanChunk, failed } = await decompressChunk(compressedChunk, this.algo);
//         if (failed) badChunks++;

//         finalData.push(cleanChunk);
//         finalSize += cleanChunk.byteLength;
//       } catch (e) { 
//         console.error("❌ Corrupt Chunk Dropped");
//       }
//     }

//     const blob = new Blob(finalData);
//     const duration = ((performance.now() - this.startTime) / 1000).toFixed(2);

//     const stats = {
//       received: this.bandwidthReceived,
//       finalSize: finalSize,
//       duration: duration,
//       badChunks: badChunks
//     };

//     console.log(`✅ RECEIVER STATS:`, stats);
    
//     this.rawChunks = []; 
//     this.onComplete(blob, stats);
//   }
// }



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