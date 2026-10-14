import { redirect } from 'next/navigation';

export default async function Page({ params }: { params: Promise<{ engagementId: string }> }) {
  redirect(`/auditflow/${(await params).engagementId}`);
}
