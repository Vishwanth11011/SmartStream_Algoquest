import { encryptChunk, decryptChunk } from './crypto';

// 128KB chunk size is optimal for WebRTC throughput and V8 memory management
const DESIRED_CHUNK_SIZE = 128 * 1024; 

/**
 * 📤 SENDER PIPELINE (Streams API Implementation)
 * Replaces the memory-intensive loop with a constant-memory stream transformer.
 */
export const sendFilePipeline = async (
  file: File,
  sharedKey: CryptoKey,
  _algo: string, 
  onChunk: (chunk: ArrayBuffer) => Promise<void>
) => {
  const startTime = performance.now();
  const originalSize = file.size;
  let finalSize = 0;
  let badChunks = 0;

  // 1. Get the native readable stream from the File object
  const sourceStream = file.stream();

  // 2. Create a TransformStream to handle buffering and encryption
  const transformStream = new TransformStream({
    start() { /* No init needed */ },
    
    // Internal buffer to handle leftovers from stream chunks
    // This is a closure variable for the transformer
    // @ts-ignore: Custom property for buffering
    buffer: new Uint8Array(0),

    async transform(chunk: Uint8Array, controller) {
        // @ts-ignore: Accessing the closure buffer
        let currentBuffer = this.buffer;

        // Efficiently merge incoming chunk with existing buffer
        if (currentBuffer.byteLength > 0) {
            const merged = new Uint8Array(currentBuffer.byteLength + chunk.byteLength);
            merged.set(currentBuffer);
            merged.set(chunk, currentBuffer.byteLength);
            currentBuffer = merged;
        } else {
            currentBuffer = chunk;
        }

        let offset = 0;
        
        // Process full chunks
        while (offset + DESIRED_CHUNK_SIZE <= currentBuffer.byteLength) {
            // Create a copy of the slice to ensure clean memory for encryption
            const slice = currentBuffer.slice(offset, offset + DESIRED_CHUNK_SIZE);
            
            try {
                // Encrypt the Uint8Array view
                const encrypted = await encryptChunk(sharedKey, slice);
                
                // TYPE FIX: Ensure we enqueue an ArrayBuffer (or Uint8Array based on need)
                // The report says to pass the view, but WebRTC needs the buffer.
                // We normalize to Uint8Array for the controller, then extract buffer for onChunk.
                const encryptedView = new Uint8Array(encrypted);
                
                controller.enqueue(encryptedView); 
                finalSize += encryptedView.byteLength;
            } catch (e) {
                console.error("Pipeline: Chunk encryption failed", e);
                badChunks++;
            }
            offset += DESIRED_CHUNK_SIZE;
        }

        // Save remainder for next iteration
        // @ts-ignore
        this.buffer = currentBuffer.slice(offset);
    },

    async flush(controller) {
        // Process any remaining bytes in the buffer
        // @ts-ignore
        const currentBuffer = this.buffer;
        if (currentBuffer.byteLength > 0) {
            try {
                const encrypted = await encryptChunk(sharedKey, currentBuffer);
                const encryptedView = new Uint8Array(encrypted);
                controller.enqueue(encryptedView);
                finalSize += encryptedView.byteLength;
            } catch (e) {
                console.error("Pipeline: Tail encryption failed", e);
                badChunks++;
            }
        }
    }
  });

  // 3. Create a WritableStream to consume the encrypted data
  const writableStream = new WritableStream({
    async write(chunk: Uint8Array) {
        // TYPE FIX: Convert the Uint8Array chunk back to ArrayBuffer for the transport layer
        // This satisfies the "Argument of type Uint8Array is not assignable to ArrayBuffer" error
        await onChunk(chunk.buffer as ArrayBuffer);
    }
  });

  // 4. Pipe the streams together
  try {
      await sourceStream.pipeThrough(transformStream).pipeTo(writableStream);
  } catch (err) {
      console.error("Pipeline: Stream processing error", err);
      throw err;
  }

  const duration = ((performance.now() - startTime) / 1000).toFixed(2);
  const speed = (originalSize / 1024 / 1024 / (Number(duration) || 1)).toFixed(2);

  return { originalSize, finalSize, duration, speed, badChunks };
};


/**
 * 📥 RECEIVER PIPELINE
 * Uses a Queue to ensure strictly ordered processing of chunks.
 */
export class ReceiverPipeline {
  private key: CryptoKey;
  // Warning: In-memory array. For >500MB files, consider FileSystem API (as per report)
  private receivedChunks: ArrayBuffer[] = []; 
  private totalSize = 0;
  private networkSize = 0; 
  private startTime = performance.now();
  private badChunks = 0;
  
  // Async Lock Queue to maintain packet order
  private processingQueue: Promise<void> = Promise.resolve(); 

  private onFinish: (blob: Blob, stats: any) => void;

  constructor(sharedKey: CryptoKey, _algo: string, onFinish: (blob: Blob, stats: any) => void) {
    this.key = sharedKey;
    this.onFinish = onFinish;
  }

  public async processChunk(chunk: ArrayBuffer) {
    this.networkSize += chunk.byteLength; 

    // Chain promises to prevent race conditions in decryption
    this.processingQueue = this.processingQueue.then(async () => {
      try {
        // TYPE FIX: Wrap ArrayBuffer in Uint8Array for crypto operation
        const byteView = new Uint8Array(chunk);
        
        // decryptChunk returns ArrayBuffer
        const decrypted = await decryptChunk(this.key, byteView);
        
        // Push the ArrayBuffer directly to our storage
        this.receivedChunks.push(decrypted);
        this.totalSize += decrypted.byteLength;
      } catch (e) {
        console.error("Pipeline: Decryption error", e);
        this.badChunks++;
      }
    });
  }

  public async finish() {
    // Wait for the queue to completely drain
    await this.processingQueue;

    // Efficiently construct the Blob from the array of buffers
    const blob = new Blob(this.receivedChunks);
    
    const duration = ((performance.now() - this.startTime) / 1000).toFixed(2);
    const speed = (this.totalSize / 1024 / 1024 / (Number(duration) || 1)).toFixed(2);

    this.onFinish(blob, {
      finalSize: this.networkSize, 
      originalSize: this.totalSize,
      duration,
      speed,
      badChunks: this.badChunks
    });

    // Release memory
    this.receivedChunks = [];
  }
}