import { encryptChunk, decryptChunk } from './crypto';

const CHUNK_SIZE = 128 * 1024; // 64KB chunks

/**
 * 📤 SENDER PIPELINE
 * Pure streaming: Reads input (raw or compressed), Encrypts, Sends.
 */
export const sendFilePipeline = async (
  file: File,
  sharedKey: CryptoKey,
  _algo: string, // Unused, keeping signature consistent
  onChunk: (chunk: ArrayBuffer) => Promise<void>
) => {
  const startTime = performance.now();
  let originalSize = file.size;
  let finalSize = 0;
  let badChunks = 0;

  const stream = file.stream();
  const reader = stream.getReader();
  
  let buffer = new Uint8Array(0);

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) {
        if (buffer.length > 0) {
          try {
            const encrypted = await encryptChunk(sharedKey, buffer);
            await onChunk(encrypted as any);
            finalSize += encrypted.byteLength;
          } catch (e) { console.error("Chunk Error (Final):", e); badChunks++; }
        }
        break;
      }

      // Buffer accumulator
      const newBuffer = new Uint8Array(buffer.length + value.length);
      newBuffer.set(buffer);
      newBuffer.set(value, buffer.length);
      buffer = newBuffer;

      // Slice exact chunks
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

  return { originalSize, finalSize, duration, speed, badChunks };
};


/**
 * 📥 RECEIVER PIPELINE (FIXED)
 * Removed live decompression to prevent hangs. 
 * Now just decrypts and assembles. Decompression happens in TransferRoom.
 */
export class ReceiverPipeline {
  private key: CryptoKey;
  
  private receivedChunks: ArrayBuffer[] = [];
  private totalSize = 0;
  private networkSize = 0; 
  private startTime = performance.now();
  private badChunks = 0;

  private onFinish: (blob: Blob, stats: any) => void;

  constructor(sharedKey: CryptoKey, _algo: string, onFinish: (blob: Blob, stats: any) => void) {
    this.key = sharedKey;
    this.onFinish = onFinish;
    // No more TransformStream here - eliminates the bottleneck
  }

  // DIRECT PROCESSING (No stream piping = No deadlocks)
  public async processChunk(chunk: Uint8Array) {
    this.networkSize += chunk.byteLength; 

    try {
      // 1. Decrypt
      const decrypted = await decryptChunk(this.key, chunk);
      
      // 2. Store directly
      this.receivedChunks.push(decrypted);
      this.totalSize += decrypted.byteLength;
    } catch (e) {
      console.error("Decryption Failed:", e);
      this.badChunks++;
    }
  }

  public async finish() {
    // No writer.close() needed anymore, just assemble
    const blob = new Blob(this.receivedChunks);
    
    const duration = ((performance.now() - this.startTime) / 1000).toFixed(2);
    const speed = (this.totalSize / 1024 / 1024 / Number(duration)).toFixed(2);

    this.onFinish(blob, {
      finalSize: this.networkSize, 
      originalSize: this.totalSize,
      duration,
      speed,
      badChunks: this.badChunks
    });
  }
}