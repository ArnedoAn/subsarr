import type { MediaItem as MediaItemPayload } from '../contracts/api';

export type { SubtitleTrack, ExternalSubtitle } from '../contracts/api';

export type MediaType = MediaItemPayload['type'];
export type ProbeStatus = MediaItemPayload['probeStatus'];

/** Internal scanner model retains Date values until HTTP JSON serialization. */
export interface MediaItem extends Omit<
  MediaItemPayload,
  'lastModified' | 'ruleStatus'
> {
  lastModified: Date;
}
