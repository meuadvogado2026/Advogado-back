export type Role = "client" | "lawyer" | "admin";

export type AuthenticatedUser = {
  id: string;
  email?: string;
  role: Role;
};
