declare module 'jschardet' {
  export interface DetectionResult {
    encoding?: string;
    confidence: number;
  }

  export function detect(buffer: Buffer | string): DetectionResult;
}
