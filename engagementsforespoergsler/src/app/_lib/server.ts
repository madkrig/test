import { cookies } from 'next/headers';
import { loadActor, prisma, type Actor } from '@/services';

export const USER_COOKIE = 'cedra-user';
/** Uden valgt bruger lander man som kernemedarbejder i arbejdskøen. */
export const DEFAULT_USER = 'u-mlund';

/** Server-komponenter læser brugeren fra samme cookie som API'et (prototype for Entra ID). */
export async function currentActor(): Promise<Actor> {
  const id = (await cookies()).get(USER_COOKIE)?.value ?? DEFAULT_USER;
  try {
    return await loadActor(prisma, id);
  } catch {
    return loadActor(prisma, DEFAULT_USER);
  }
}

export { prisma };
