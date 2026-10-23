export interface QuickUpload {
  originalname: string;
  buffer: Buffer;
}
export const QUICK_LIMITS = {
  fileBytes: 2 * 1024 * 1024,
  batchBytes: 20 * 1024 * 1024,
  files: 20,
  inputBytes: 40 * 1024 * 1024,
  resultBytes: 40 * 1024 * 1024,
  resultFileBytes: 8 * 1024 * 1024,
  batches: 100,
  ttlMs: 60 * 60 * 1000,
} as const;
