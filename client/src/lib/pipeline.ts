import { encryptChunk, decryptChunk } from './crypto';

const DESIRED_CHUNK_SIZE = 128 * 1024; 

// ✅ FIX: Accepts 'Blob' to prevent file property errors
export const sendFilePipeline = async (
  file: Blob, 
  sharedKey: CryptoKey,
  _algo: string, 
  onChunk: (chunk: ArrayBuffer) => Promise<void>
) => {
  const startTime = performance.now();
  const originalSize = file.size;
  let finalSize = 0;
  let badChunks = 0;

  const sourceStream = file.stream();

  const transformStream = new TransformStream({
    start() {},
    // @ts-ignore
    buffer: new Uint8Array(0),

    async transform(chunk: Uint8Array, controller) {
        // @ts-ignore
        let currentBuffer = this.buffer;
        if (currentBuffer.byteLength > 0) {
            const merged = new Uint8Array(currentBuffer.byteLength + chunk.byteLength);
            merged.set(currentBuffer);
            merged.set(chunk, currentBuffer.byteLength);
            currentBuffer = merged;
        } else {
            currentBuffer = chunk;
        }

        let offset = 0;
        while (offset + DESIRED_CHUNK_SIZE <= currentBuffer.byteLength) {
            const slice = currentBuffer.slice(offset, offset + DESIRED_CHUNK_SIZE);
            try {
                const encrypted = await encryptChunk(sharedKey, slice);
                controller.enqueue(encrypted);
                finalSize += encrypted.byteLength;
            } catch (e) { badChunks++; }
            offset += DESIRED_CHUNK_SIZE;
        }
        // @ts-ignore
        this.buffer = currentBuffer.slice(offset);
    },

    async flush(controller) {
        // @ts-ignore
        if (this.buffer.byteLength > 0) {
            try {
                // @ts-ignore
                const encrypted = await encryptChunk(sharedKey, this.buffer);
                controller.enqueue(encrypted);
                finalSize += encrypted.byteLength;
            } catch (e) { badChunks++; }
        }
    }
  });

  const writableStream = new WritableStream({
    async write(chunk: Uint8Array) {
        await onChunk(chunk.buffer as ArrayBuffer);
    }
  });

  try {
      await sourceStream.pipeThrough(transformStream).pipeTo(writableStream);
  } catch (err) { throw err; }

  const duration = ((performance.now() - startTime) / 1000).toFixed(2);
  const speed = (originalSize / 1024 / 1024 / (Number(duration) || 1)).toFixed(2);
  return { originalSize, finalSize, duration, speed, badChunks };
};

export class ReceiverPipeline {
  private key: CryptoKey;
  private receivedChunks: Uint8Array[] = []; 
  private totalSize = 0;
  private networkSize = 0; 
  private startTime = performance.now();
  private badChunks = 0;
  private processingQueue: Promise<void> = Promise.resolve(); 
  private onFinish: (blob: Blob, stats: any) => void;

  constructor(sharedKey: CryptoKey, _algo: string, onFinish: (blob: Blob, stats: any) => void) {
    this.key = sharedKey;
    this.onFinish = onFinish;
  }

  public async processChunk(chunk: ArrayBuffer) {
    this.networkSize += chunk.byteLength; 
    this.processingQueue = this.processingQueue.then(async () => {
      try {
        const byteView = new Uint8Array(chunk);
        const decrypted = await decryptChunk(this.key, byteView);
        // Convert ArrayBuffer to Uint8Array for proper Blob handling
        this.receivedChunks.push(new Uint8Array(decrypted));
        this.totalSize += decrypted.byteLength;
      } catch (e) { this.badChunks++; }
    });
  }

  public async finish() {
    await this.processingQueue;
    // Blob constructor properly handles array of Uint8Array chunks
    const blob = new Blob(this.receivedChunks as BlobPart[]);
    const duration = ((performance.now() - this.startTime) / 1000).toFixed(2);
    const speed = (this.totalSize / 1024 / 1024 / (Number(duration) || 1)).toFixed(2);
    this.onFinish(blob, { finalSize: this.networkSize, originalSize: this.totalSize, duration, speed, badChunks: this.badChunks });
    this.receivedChunks = [];
  }
}