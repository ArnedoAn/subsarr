import Link from 'next/link';

interface TranslationResultSummaryProps {
  result: {
    qualityReport?: { warningCount: number; errorCount: number; suspectCueIndices: number[] };
    checkpointReusedCues?: number;
    memoryReusedCues?: number;
    contextSheet?: string;
  };
  mediaItemId?: string;
}

export function TranslationResultSummary({ result, mediaItemId }: TranslationResultSummaryProps) {
  return <div className="space-y-2 text-xs text-on-surface-variant">
    {result.qualityReport && <p>Quality report: {result.qualityReport.warningCount} warnings · {result.qualityReport.errorCount} errors · {result.qualityReport.suspectCueIndices.length} suspect cues. Readability checks do not guarantee translation accuracy.</p>}
    {(result.checkpointReusedCues !== undefined || result.memoryReusedCues !== undefined) && <p>Checkpoint reuse: {(result.checkpointReusedCues ?? 0).toLocaleString()} cues · Approved memory reuse: {(result.memoryReusedCues ?? 0).toLocaleString()} cues</p>}
    {result.contextSheet && <details><summary className="cursor-pointer">Generated context sheet</summary><p className="mt-2 whitespace-pre-wrap break-words">{result.contextSheet}</p></details>}
    {mediaItemId && <Link className="inline-block text-primary underline" href={`/review?mediaId=${encodeURIComponent(mediaItemId)}`}>Open in review</Link>}
  </div>;
}
