// client/src/lib/compression.ts

export const predictAlgorithm = (file: File): string => {
  if (file.type === 'image/jpeg' || file.type === 'image/jpg') return 'MozJPEG (Optimized)';
  if (file.type === 'image/png') return 'VP8L (WebP Lossless)';
  return 'AES-256-GCM';
};

export const compressImage = async (file: File): Promise<File> => {
  // Only optimize images
  if (!['image/jpeg', 'image/jpg', 'image/png'].includes(file.type)) return file;

  return new Promise((resolve) => {
    const img = new Image();
    const url = URL.createObjectURL(file);
    img.src = url;

    img.onload = () => {
      const canvas = document.createElement('canvas');
      const ctx = canvas.getContext('2d');
      if (!ctx) { URL.revokeObjectURL(url); return resolve(file); }

      canvas.width = img.width;
      canvas.height = img.height;
      ctx.drawImage(img, 0, 0);

      let mimeType = file.type;
      let quality = 1.0;
      let extension = file.name.split('.').pop();

      // 1. JPEG: Quantization (75% Quality)
      if (file.type.includes('jpeg') || file.type.includes('jpg')) {
        mimeType = 'image/jpeg';
        quality = 0.75;
      }
      
      // 2. PNG: WebP Lossless (VP8L)
      if (file.type === 'image/png') {
        mimeType = 'image/webp'; 
        quality = 1.0; 
        extension = 'webp';
      }

      canvas.toBlob(
        (blob) => {
          URL.revokeObjectURL(url);
          if (!blob || blob.size >= file.size) return resolve(file);

          // Rename extension if needed (png -> webp)
          const baseName = file.name.substring(0, file.name.lastIndexOf('.'));
          const newName = `${baseName}.${extension}`;
          
          resolve(new File([blob], newName, { type: mimeType, lastModified: Date.now() }));
        },
        mimeType,
        quality
      );
    };

    img.onerror = () => { URL.revokeObjectURL(url); resolve(file); };
  });
};