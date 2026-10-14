import { redirect } from 'next/navigation';

export default async function Page({ params }: { params: Promise<{ bankId: string }> }) {
  redirect(`/admin/banks?bank=${(await params).bankId}`);
}
