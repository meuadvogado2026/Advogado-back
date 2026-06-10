export type Role = "client" | "lawyer" | "admin";

export type AuthenticatedUser = {
  id: string;
  name?: string;
  email?: string;
  role: Role;
  mustChangePassword?: boolean;
  firstLoginCompletedAt?: string | null;
};
