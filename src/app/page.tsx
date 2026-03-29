import { redirect } from "next/navigation";
import { getRoleHomePath } from "@/shared/auth/roles";
import { getCurrentSessionUser } from "@/shared/auth/session";

export const dynamic = "force-dynamic";

export default async function Home() {
  const user = await getCurrentSessionUser();
  if (!user) {
    redirect("/login");
  }

  redirect(getRoleHomePath(user.role));
}
