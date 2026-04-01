export type SubtitleOutputExtension = 'srt' | 'ass';

/** ffprobe codec_name values for embedded ASS/SSA subtitle streams */
const ASS_SUBTITLE_CODECS = new Set(['ass', 'ssa']);

export function isAssSubtitleCodec(codec: string): boolean {
  return ASS_SUBTITLE_CODECS.has(codec.trim().toLowerCase());
}

export function subtitleOutputExtensionFromCodec(codec: string): SubtitleOutputExtension {
  return isAssSubtitleCodec(codec) ? 'ass' : 'srt';
}
