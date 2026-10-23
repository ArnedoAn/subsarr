'use client';
import { useParams } from 'next/navigation';
import { ItemDetail } from '@/components/library/item-detail';
export default function LibraryItemPage() {
  const { id } = useParams<{ id: string }>();
  return <ItemDetail key={id} id={id} />;
}
