export const DEMO_USERS = [
  {
    id: 'analyst',
    label: 'Analyst',
  },
  {
    id: 'reviewer',
    label: 'Reviewer',
  },
  {
    id: 'admin',
    label: 'Admin',
  },
] as const;

export interface DemoUserCredential {
  id: string;
  name: string;
  email: string;
}
