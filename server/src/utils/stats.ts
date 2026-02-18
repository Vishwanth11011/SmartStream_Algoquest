/**
 * 📊 Compression Statistics Utilities (Server-side)
 * Ensures consistent calculation of compression metrics on both client and server
 */

export interface CompressionStats {
  originalSize: number;
  compressedSize: number;
  compressionPercent: number;
  compressionRatio: number;
  spaceSaved: number;
}

/**
 * Calculate compression percentage
 * Formula: (1 - compressedSize / originalSize) * 100
 * 
 * @example
 * // 100 bytes -> 50 bytes = 50% compression
 * calculateCompressionPercent(100, 50) // Returns 50
 */
export const calculateCompressionPercent = (originalSize: number, compressedSize: number): number => {
  if (originalSize === 0) return 0;
  return parseFloat(((1 - compressedSize / originalSize) * 100).toFixed(2));
};

/**
 * Calculate compression ratio
 * Formula: originalSize / compressedSize
 * 
 * @example
 * // 100 bytes -> 50 bytes = 2:1 ratio
 * calculateCompressionRatio(100, 50) // Returns 2.00
 */
export const calculateCompressionRatio = (originalSize: number, compressedSize: number): number => {
  if (compressedSize === 0) return 0;
  return parseFloat((originalSize / compressedSize).toFixed(2));
};

/**
 * Calculate space saved in bytes
 */
export const calculateSpaceSaved = (originalSize: number, compressedSize: number): number => {
  return originalSize - compressedSize;
};

/**
 * Get comprehensive compression statistics
 * Use this on both client and server for consistency
 */
export const getCompressionStats = (originalSize: number, compressedSize: number): CompressionStats => {
  return {
    originalSize,
    compressedSize,
    compressionPercent: calculateCompressionPercent(originalSize, compressedSize),
    compressionRatio: calculateCompressionRatio(originalSize, compressedSize),
    spaceSaved: calculateSpaceSaved(originalSize, compressedSize)
  };
};

/**
 * Format compression percentage for display
 * @example
 * formatCompressionPercent(50.123) // Returns "50.12%"
 */
export const formatCompressionPercent = (percent: number): string => {
  return `${percent.toFixed(2)}%`;
};

/**
 * Format compression ratio for display
 * @example
 * formatCompressionRatio(2.5) // Returns "2.5:1"
 */
export const formatCompressionRatio = (ratio: number): string => {
  return `${ratio.toFixed(2)}:1`;
};
