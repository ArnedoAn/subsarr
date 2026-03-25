'use client';

import Link from 'next/link';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useParams } from 'next/navigation';
import { apiGet, apiPost } from '@/lib/api';
import { type JobResult, type MediaItem, type RuleEvaluation } from '@/lib/types';
import { COMMON_LANGUAGES } from '@/lib/languages';

interface ItemDetail extends MediaItem {
  rules: RuleEvaluation[];
}

export default function LibraryItemPage() {
  const params = useParams<{ id: string }>();
  const [item, setItem] = useState<ItemDetail | null>(null);
  const [jobs, setJobs] = useState<JobResult[]>([]);
  const [sourceTrackIndex, setSourceTrackIndex] = useState<number | null>(null);
  const [sourceLanguage, setSourceLanguage] = useState('eng');
  const [targetLanguage, setTargetLanguage] = useState('spa');
  const [forceBypass, setForceBypass] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      const [itemResponse, jobsResponse] = await Promise.all([
        apiGet<ItemDetail>(`/library/${params.id}`),
        apiGet<JobResult[]>('/jobs'),
      ]);
      setItem(itemResponse);
      const firstTrack = itemResponse.subtitleTracks[0];
      setSourceTrackIndex(firstTrack?.index ?? null);
      setSourceLanguage(firstTrack?.language ?? 'eng');
      setJobs(jobsResponse.filter((job) => job.data.mediaItemId === params.id));
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : 'Failed to load media item');
    }
  }, [params.id]);

  useEffect(() => {
    void load();
  }, [load]);

  const isBlocked = useMemo(() => item?.rules.some((rule) => rule.skip) ?? false, [item]);

  const queue = async () => {
    if (!item || sourceTrackIndex === null) {
      return;
    }

    await apiPost('/jobs', {
      mediaItemId: item.id,
      mediaItemPath: item.path,
      sourceLanguage,
      targetLanguage,
      sourceTrackIndex,
      triggeredBy: 'manual',
      forceBypassRules: forceBypass,
    });

    await load();
  };

  if (!item) {
    return (
      <div className="flex items-center justify-center py-12">
        <p className="text-sm text-on-surface-variant">Loading media detail...</p>
      </div>
    );
  }

  return (
    <section className="space-y-8">
      {error ? (
        <div className="rounded-lg bg-error-container px-4 py-3 text-sm text-on-error-container border-l-4 border-error">
          {error}
        </div>
      ) : null}

      {/* Media Info Header */}
      <div className="bg-surface-container rounded-xl p-8">
        <h2 className="text-2xl font-headline font-black uppercase tracking-[0.05em] text-on-surface">
          {item.name}
        </h2>
        <p className="mt-2 text-sm font-mono text-on-surface-variant">{item.path}</p>
        <p className="mt-2 text-xs text-on-surface-variant">
          Size: {Math.round(item.size / 1024 / 1024)} MB · Modified: {new Date(item.lastModified).toLocaleString()}
        </p>
      </div>

      <div className="grid grid-cols-12 gap-8">
        {/* LEFT: Subtitle Tracks */}
        <div className="col-span-12 lg:col-span-5">
          <div className="bg-surface-container rounded-xl p-8 space-y-6">
            <h3 className="section-label">Embedded Subtitles</h3>
            <div className="space-y-3">
              {item.subtitleTracks.map((track) => (
                <label
                  key={track.index}
                  className={`flex items-center justify-between p-4 rounded-lg cursor-pointer transition-colors ${
                    sourceTrackIndex === track.index
                      ? 'bg-primary/10 border border-primary/30'
                      : 'bg-surface-container-high hover:bg-surface-bright'
                  }`}
                >
                  <span className="text-sm font-mono text-on-surface">
                    #{track.index} · {track.language} · {track.codec}
                  </span>
                  <input
                    type="radio"
                    checked={sourceTrackIndex === track.index}
                    onChange={() => {
                      setSourceTrackIndex(track.index);
                      setSourceLanguage(track.language);
                    }}
                    className="h-4 w-4 accent-primary"
                  />
                </label>
              ))}
            </div>

            <h4 className="section-label mt-6">External Subtitles</h4>
            <ul className="space-y-2 text-xs font-mono text-on-surface-variant">
              {item.externalSubtitles.map((subtitle) => (
                <li key={subtitle.path} className="bg-surface-container-high p-3 rounded-lg">
                  {subtitle.path}
                </li>
              ))}
            </ul>
          </div>
        </div>

        {/* RIGHT: Translation Controls */}
        <div className="col-span-12 lg:col-span-7">
          <div className="bg-surface-container rounded-xl p-8 space-y-6">
            <h3 className="section-label">Translation Pipeline</h3>
            <div className="grid grid-cols-2 gap-6">
              <div className="space-y-2">
                <label className="field-label">Source Language</label>
                <div className="relative">
                  <select
                    value={sourceLanguage}
                    onChange={(event) => {
                      const language = event.target.value;
                      setSourceLanguage(language);
                      const track = item.subtitleTracks.find((candidate) => candidate.language === language);
                      if (track) {
                        setSourceTrackIndex(track.index);
                      }
                    }}
                    className="w-full engraved-input text-sm p-4 pr-10 rounded-lg text-on-surface appearance-none bg-surface-container-lowest cursor-pointer transition-all duration-200"
                  >
                    {Array.from(new Set(item.subtitleTracks.map((track) => track.language))).map((language) => (
                      <option key={language} value={language}>
                        {language.toUpperCase()}
                      </option>
                    ))}
                  </select>
                  <span className="material-symbols-outlined absolute right-3 top-1/2 -translate-y-1/2 text-on-surface-variant pointer-events-none">
                    expand_more
                  </span>
                </div>
              </div>
              <div className="space-y-2">
                <label className="field-label">Target Language</label>
                <div className="relative">
                  <select
                    value={targetLanguage}
                    onChange={(event) => setTargetLanguage(event.target.value)}
                    className="w-full engraved-input text-sm p-4 pr-10 rounded-lg text-on-surface appearance-none bg-surface-container-lowest cursor-pointer transition-all duration-200"
                  >
                    {COMMON_LANGUAGES.map((lang) => (
                      <option key={`tgt-${lang.code}`} value={lang.code}>
                        {lang.name} ({lang.code})
                      </option>
                    ))}
                  </select>
                  <span className="material-symbols-outlined absolute right-3 top-1/2 -translate-y-1/2 text-on-surface-variant pointer-events-none">
                    expand_more
                  </span>
                </div>
              </div>
            </div>

            {/* Rules Check */}
            <div className="bg-surface-container-high p-6 rounded-xl">
              <div className="flex items-center justify-between mb-4">
                <p className="text-sm font-bold text-on-surface">Rules Check</p>
                {isBlocked && (
                  <span className="badge badge-secondary">BLOCKED</span>
                )}
              </div>
              <div className="space-y-3">
                {item.rules.map((rule) => (
                  <div
                    key={rule.id}
                    className="flex items-center justify-between p-3 rounded-lg bg-surface-container"
                  >
                    <span className="text-sm text-on-surface">{rule.label}</span>
                    <span
                      className={`text-xs font-bold uppercase tracking-widest ${
                        rule.skip ? 'text-error' : 'text-primary'
                      }`}
                    >
                      {rule.skip ? `X ${rule.reason ?? ''}` : 'PASS'}
                    </span>
                  </div>
                ))}
              </div>
            </div>

            {isBlocked ? (
              <label className="flex items-center gap-3 p-4 rounded-lg bg-secondary/10 border border-secondary/30 cursor-pointer">
                <input
                  type="checkbox"
                  checked={forceBypass}
                  onChange={(event) => setForceBypass(event.target.checked)}
                  className="h-5 w-5 accent-secondary"
                />
                <span className="text-sm font-bold text-secondary">FORCE BYPASS RULES</span>
              </label>
            ) : null}

            <button
              onClick={() => void queue()}
              className="w-full bg-gradient-to-br from-primary to-primary-container px-6 py-3 rounded text-xs font-black tracking-widest text-on-primary-container shadow-[0_0_15px_rgba(47,217,244,0.3)] hover:brightness-110 transition-all"
            >
              QUEUE TRANSLATION
            </button>
          </div>
        </div>
      </div>

      {/* Job History */}
      <div className="bg-surface-container rounded-xl p-8">
        <div className="flex items-center justify-between mb-6">
          <h3 className="section-label">Job History</h3>
          <Link href="/jobs" className="text-xs font-bold uppercase tracking-widest text-primary hover:text-primary/70">
            OPEN ALL JOBS
          </Link>
        </div>
        <div className="space-y-3">
          {jobs.length === 0 ? (
            <p className="text-sm text-on-surface-variant">No jobs found for this item.</p>
          ) : (
            jobs.map((job) => (
              <div
                key={String(job.id)}
                className="flex items-center justify-between p-4 rounded-lg bg-surface-container-high"
              >
                <div>
                  <p className="text-sm font-bold text-on-surface">
                    #{job.id} · <span className="font-mono uppercase">{job.state}</span>
                  </p>
                  <p className="text-xs font-mono text-on-surface-variant mt-1">
                    {job.data.sourceLanguage.toUpperCase()} → {job.data.targetLanguage.toUpperCase()}
                  </p>
                  {job.returnValue ? (
                    <p className="text-xs font-mono text-on-surface-variant">
                      {job.returnValue.usage.totalTokens} tokens · {job.returnValue.tierUsed}
                    </p>
                  ) : null}
                </div>
                <span
                  className={`badge ${
                    job.state === 'completed'
                      ? 'badge-success'
                      : job.state === 'failed'
                        ? 'badge-error'
                        : job.state === 'active'
                          ? 'badge-primary'
                          : 'badge-secondary'
                  }`}
                >
                  {job.state}
                </span>
              </div>
            ))
          )}
        </div>
      </div>
    </section>
  );
}
