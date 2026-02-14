// client/src/lib/pipeline.ts
import { encryptChunk, decryptChunk } from './crypto';

const CHUNK_SIZE = 128 * 1024; // 64KB chunks (Optimal for WebRTC/Socket.io)

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

