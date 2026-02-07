// client/src/lib/pipeline.ts
import { encryptChunk, decryptChunk } from './crypto';

const CHUNK_SIZE = 1024 * 1024; // 64KB chunks (Optimal for WebRTC/Socket.io)

/**
 * 📤 SENDER PIPELINE
 * 1. Compress (Optional) -> 2. Encrypt -> 3. Send
 */
export const sendFilePipeline = async (
  file: File,
  sharedKey: CryptoKey,
  algo: string,
  onChunk: (chunk: ArrayBuffer) => Promise<void>
) => {
  const startTime = performance.now();
  let originalSize = file.size;
  let finalSize = 0;
  let badChunks = 0;

  // 1. CREATE STREAM SOURCE
  let stream = file.stream();

  // 2. APPLY COMPRESSION (The Missing Link)
  // Note: Browsers use 'deflate' as the closest standard to Brotli
  if (algo === 'Gzip') {
    stream = stream.pipeThrough(new CompressionStream('gzip'));
  } else if (algo === 'Brotli') {
    stream = stream.pipeThrough(new CompressionStream('deflate')); 
  }

  // 3. READ & PROCESS
  const reader = stream.getReader();
  let buffer = new Uint8Array(0); // Buffer to accumulate variable chunk sizes

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) {
        // Process any remaining bytes in buffer
        if (buffer.length > 0) {
          try {
            const encrypted = await encryptChunk(sharedKey, buffer);
            await onChunk(encrypted as any);
            finalSize += encrypted.byteLength;
          } catch (e) { console.error("Chunk Error (Final):", e); badChunks++; }
        }
        break;
      }

      // Append new data to buffer
      const newBuffer = new Uint8Array(buffer.length + value.length);
      newBuffer.set(buffer);
      newBuffer.set(value, buffer.length);
      buffer = newBuffer;

      // Slice off precise 64KB chunks to keep encryption stable
      while (buffer.length >= CHUNK_SIZE) {
        const chunk = buffer.slice(0, CHUNK_SIZE);
        buffer = buffer.slice(CHUNK_SIZE);

        try {
          const encrypted = await encryptChunk(sharedKey, chunk);
          await onChunk(encrypted as any);
          finalSize += encrypted.byteLength;
        } catch (e) {
          console.error("Chunk Error:", e);
          badChunks++;
        }
      }
    }
  } catch (err) {
    console.error("Pipeline Error:", err);
    throw err;
  }

  const duration = ((performance.now() - startTime) / 1000).toFixed(2);
  const speed = (originalSize / 1024 / 1024 / Number(duration)).toFixed(2);

  return {
    originalSize,
    finalSize, // If compression worked, this will be smaller!
    duration,
    speed,
    badChunks
  };
};


/**
 * 📥 RECEIVER PIPELINE
 * 1. Decrypt -> 2. Decompress (Optional) -> 3. Rebuild File
 */
// ... (Keep the sendFilePipeline function as is) ...

/**
 * 📥 RECEIVER PIPELINE
 * 1. Decrypt -> 2. Decompress (Optional) -> 3. Rebuild File
 */
export class ReceiverPipeline {
  private key: CryptoKey;
  private algo: string;
  private writer: WritableStreamDefaultWriter;
  
  private receivedChunks: ArrayBuffer[] = [];
  private totalSize = 0;   // The size of the FINAL (decompressed) file
  private networkSize = 0; // ✅ NEW: The size of COMPRESSED data received
  private startTime = performance.now();
  private badChunks = 0;

  private onFinish: (blob: Blob, stats: any) => void;

  constructor(sharedKey: CryptoKey, algo: string, onFinish: (blob: Blob, stats: any) => void) {
    this.key = sharedKey;
    this.algo = algo;
    this.onFinish = onFinish;

    // 1. SETUP DECOMPRESSION STREAM
    let transformStream = new TransformStream(); 
    const { readable, writable } = transformStream;
    this.writer = writable.getWriter();

    let outputStream = readable;
    
    if (this.algo === 'Gzip') {
      outputStream = outputStream.pipeThrough(new DecompressionStream('gzip'));
    } else if (this.algo === 'Brotli') {
      outputStream = outputStream.pipeThrough(new DecompressionStream('deflate'));
    }

    this.readStream(outputStream);
  }

  // Helper to read the decompressed stream (Rebuilding the original file)
  private async readStream(stream: ReadableStream) {
    const reader = stream.getReader();
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        this.receivedChunks.push(value);
        this.totalSize += value.byteLength; // Tracks Original Size
      }
    } catch (e) {
      console.error("Decompression Error:", e);
      this.badChunks++;
    }
  }

  public async processChunk(chunk: Uint8Array) {
    // ✅ TRACK NETWORK USAGE HERE (Before processing)
    this.networkSize += chunk.byteLength; 

    try {
      // 1. Decrypt
      const decrypted = await decryptChunk(this.key, chunk);
      
      // 2. Push to Decompressor
      await this.writer.write(decrypted);
    } catch (e) {
      console.error("Decryption Failed:", e);
      this.badChunks++;
    }
  }

  public async finish() {
    await this.writer.close();
    await new Promise(r => setTimeout(r, 100)); // Flush stream

    const blob = new Blob(this.receivedChunks);
    
    const duration = ((performance.now() - this.startTime) / 1000).toFixed(2);
    // Speed based on ORIGINAL size (User experience speed), or use networkSize for network speed.
    // Usually "Transfer Speed" implies effective throughput, so originalSize is better for UX.
    const speed = (this.totalSize / 1024 / 1024 / Number(duration)).toFixed(2);

    this.onFinish(blob, {
      finalSize: this.networkSize, // ✅ NOW RETURNS COMPRESSED SIZE
      originalSize: this.totalSize, // Decompressed/Original size
      duration,
      speed,
      badChunks: this.badChunks
    });
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