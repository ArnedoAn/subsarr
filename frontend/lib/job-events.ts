'use client';

import { useEffect, useRef, useState } from 'react';
import { API_URL } from './api';

export interface JobStreamEvent {
  jobId: string;
  type?: string;
  phase?: string;
  timestamp?: string;
  message?: string;
  [key: string]: unknown;
}
export type JobStreamState = 'connecting' | 'connected' | 'disconnected' | 'paused';
interface Subscriber { event: (event: JobStreamEvent) => void; state?: (state: JobStreamState) => void }
const subscribers = new Set<Subscriber>();
let source: EventSource | null = null;
let timer: number | undefined;
let attempt = 0;
let lastEventId = '';
const seen = new Set<string>();
let connection: JobStreamState = 'disconnected';
let pageSuspended = false;
function setConnection(next: JobStreamState) {
  connection = next;
  for (const subscriber of subscribers) subscriber.state?.(next);
}
function stopConnection() {
  window.clearTimeout(timer);
  timer = undefined;
  source?.close();
  source = null;
}
function connect() {
  if (!subscribers.size || source || document.hidden || pageSuspended) return;
  window.clearTimeout(timer);
  timer = undefined;
  setConnection('connecting');
  const cursor = lastEventId ? `?lastEventId=${encodeURIComponent(lastEventId)}` : '';
  const stream = new EventSource(`${API_URL}/jobs/stream${cursor}`);
  source = stream;
  stream.onopen = () => { if (source !== stream) return; attempt = 0; setConnection('connected'); };
  stream.addEventListener('stream-ready', event => {
    if (source === stream && event instanceof MessageEvent && event.lastEventId) lastEventId = event.lastEventId;
  });
  stream.onmessage = message => {
    if (source !== stream) return;
    let event: JobStreamEvent;
    try {
      const parsed: unknown = JSON.parse(message.data);
      if (!parsed || typeof parsed !== 'object' || !('jobId' in parsed) || typeof parsed.jobId !== 'string') return;
      event = parsed as JobStreamEvent;
    } catch { return; }
    if (message.lastEventId) lastEventId = message.lastEventId;
    const key = message.lastEventId || `${event.jobId}:${event.phase ?? event.type}:${event.timestamp ?? ''}`;
    if (seen.has(key)) return;
    seen.add(key);
    if (seen.size > 1000) { const oldest = seen.values().next().value; if (oldest) seen.delete(oldest); }
    for (const subscriber of subscribers) subscriber.event(event);
  };
  stream.onerror = () => {
    if (source !== stream) return;
    // Own retry scheduling even when the browser reports CLOSED (which never auto-reconnects).
    stopConnection();
    setConnection(document.hidden || pageSuspended ? 'paused' : 'disconnected');
    if (!document.hidden && !pageSuspended && subscribers.size) {
      const delay = Math.min(30000, 1000 * 2 ** Math.min(attempt++, 5));
      timer = window.setTimeout(connect, delay);
    }
  };
}
function visibilityChanged() {
  stopConnection();
  if (document.hidden || pageSuspended) setConnection('paused');
  else { attempt = 0; connect(); }
}
function pageHidden() {
  pageSuspended = true;
  stopConnection();
  setConnection('paused');
}
function pageShown() {
  pageSuspended = false;
  if (document.hidden) setConnection('paused');
  else { attempt = 0; connect(); }
}
/** All subscribers in a tab share one connection and one bounded-backoff retry timer. */
export function subscribeJobEvents(onEvent: (event: JobStreamEvent) => void, onState?: (state: JobStreamState) => void) {
  const subscriber: Subscriber = { event: onEvent, state: onState };
  subscribers.add(subscriber);
  if (subscribers.size === 1) {
    document.addEventListener('visibilitychange', visibilityChanged);
    window.addEventListener('pagehide', pageHidden);
    window.addEventListener('pageshow', pageShown);
    if (document.hidden) setConnection('paused'); else connect();
  }
  onState?.(connection);
  return () => {
    subscribers.delete(subscriber);
    if (!subscribers.size) {
      stopConnection();
      attempt = 0;
      pageSuspended = false;
      connection = 'disconnected';
      document.removeEventListener('visibilitychange', visibilityChanged);
      window.removeEventListener('pagehide', pageHidden);
      window.removeEventListener('pageshow', pageShown);
    }
  };
}
/** Callback changes never reconnect; an optional enabled flag pauses just this subscriber. */
export function useJobEvents(onEvent?: (event: JobStreamEvent) => void, enabled = true): JobStreamState {
  const callback = useRef(onEvent);
  const [state, setState] = useState<JobStreamState>('connecting');
  useEffect(() => { callback.current = onEvent; }, [onEvent]);
  useEffect(() => {
    if (!enabled) { setState('paused'); return; }
    return subscribeJobEvents(event => callback.current?.(event), setState);
  }, [enabled]);
  return state;
}
