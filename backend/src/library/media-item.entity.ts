export type MediaType = 'movie' | 'episode' | 'unknown';

export interface SubtitleTrack {
  index: number;
  language: string;
  title?: string;
  codec: string;
}

export interface ExternalSubtitle {
  path: string;
  language: string;
  forced: boolean;
}

export interface MediaItem {
  id: string;
  path: string;
  name: string;
  type: MediaType;
  subtitleTracks: SubtitleTrack[];
  externalSubtitles: ExternalSubtitle[];
  size: number;
  lastModified: Date;
}
