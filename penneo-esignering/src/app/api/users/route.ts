import { NextResponse } from 'next/server';
import { prisma } from '@/services';

/** GET /api/users – Brugere til prototypens brugervælger (ingen rigtig login) */
export async function GET() {
  const users = await prisma.user.findMany({ where: { role: 'AUDITOR' }, orderBy: { name: 'asc' }, select: { id: true, name: true } });
  return NextResponse.json({ data: users });
}
