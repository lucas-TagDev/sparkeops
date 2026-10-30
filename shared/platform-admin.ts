export type ManagedWorkspace = {
  id: string;
  name: string;
  plan: string;
  subscription_status: string;
  created_at: number;
  users: number;
  organizations: number;
  servers: number;
};
export type ManagedMember = {
  id: string;
  name: string;
  email: string;
  role: string;
  organizations: string[];
};
export type WorkspaceDetails = {
  workspace: ManagedWorkspace;
  members: ManagedMember[];
  organizations: { id: string; name: string }[];
};
export type WorkspacePage = {
  items: ManagedWorkspace[];
  total: number;
  page: number;
  pages: number;
  page_size: number;
};
