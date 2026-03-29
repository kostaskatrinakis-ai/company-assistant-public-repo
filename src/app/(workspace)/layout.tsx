import { WorkspaceShell } from "@/components/workspace-shell";
import { requireSessionUser } from "@/shared/auth/session";

export const dynamic = "force-dynamic";

export default async function WorkspaceLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const user = await requireSessionUser();

  return <WorkspaceShell user={user}>{children}</WorkspaceShell>;
}
