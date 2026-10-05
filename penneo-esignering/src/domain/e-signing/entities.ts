export type UserRole = 'AUDITOR' | 'SYSTEM';

export interface User {
  id: string;
  name: string;
  email: string;
  role: UserRole;
}

export type IsoDate = string;
