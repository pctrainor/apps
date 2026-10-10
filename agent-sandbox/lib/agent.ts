import { cookies } from "next/headers";

export const AGENT_COOKIE = "agent";

/** The name the visitor signed in with on the home page, or null. */
export async function currentAgent(): Promise<string | null> {
  const value = (await cookies()).get(AGENT_COOKIE)?.value?.trim();
  return value ? value : null;
}
