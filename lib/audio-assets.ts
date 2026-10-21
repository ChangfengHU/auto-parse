export type AudioAssetKind = 'music' | 'sound_effect';

export interface AudioAsset {
  provider?: 'openverse' | 'wikimedia';
  fileNote?: string;
  id: string;
  kind: AudioAssetKind;
  title: string;
  creator: string;
  durationMs: number | null;
  previewUrl: string;
  waveformUrl: string | null;
  thumbnailUrl: string | null;
  source: string;
  sourceUrl: string;
  license: string;
  licenseUrl: string | null;
  attribution: string;
  tags: string[];
  fileType: string | null;
}
export interface AudioSearchResponse {
  items: AudioAsset[];
  total: number;
  page: number;
  pageSize: number;
  hasNext: boolean;
  provider: 'openverse' | 'wikimedia';
  notice?: string;
  totalExact?: boolean;
  query: string;
}
