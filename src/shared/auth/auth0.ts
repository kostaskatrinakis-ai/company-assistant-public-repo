import { Auth0Client } from "@auth0/nextjs-auth0/server";
import { isAuth0Configured } from "@/shared/config/env";

export const auth0 = isAuth0Configured ? new Auth0Client() : null;
export { isAuth0Configured };
