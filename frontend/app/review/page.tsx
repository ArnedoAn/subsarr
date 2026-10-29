import { Suspense } from 'react';
import { ReviewWorkspace } from '@/components/review-workspace';

export default function ReviewPage() {
  return <Suspense fallback={<p className="p-6" role="status">Loading subtitle workspace…</p>}><ReviewWorkspace /></Suspense>;
}
