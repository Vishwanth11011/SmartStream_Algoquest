declare module 'snappyjs' {
  export function compress(data: ArrayBuffer): ArrayBuffer;
  export function uncompress(data: ArrayBuffer): ArrayBuffer;
}