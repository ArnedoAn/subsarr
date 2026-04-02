export type SubtitleOutputExtension = 'srt' | 'ass';

/** ffprobe codec_name values for embedded ASS/SSA subtitle streams */
const ASS_SUBTITLE_CODECS = new Set([
  'ass',
  'ssa',
  /** Some builds / containers report SSA streams this way */
  'ssa_subtitle',
]);

export function isAssSubtitleCodec(codec: string): boolean {
  return ASS_SUBTITLE_CODECS.has(codec.trim().toLowerCase());
}

export function subtitleOutputExtensionFromCodec(codec: string): SubtitleOutputExtension {
  return isAssSubtitleCodec(codec) ? 'ass' : 'srt';
}
