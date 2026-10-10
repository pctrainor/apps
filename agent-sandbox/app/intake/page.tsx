import Link from "next/link";
import { currentAgent } from "@/lib/agent";
import IntakeForm from "./IntakeForm";

export default async function IntakePage() {
  const agent = await currentAgent();
  return (
    <>
      <h1>Customer intake form</h1>
      <p className="lede">
        Add one customer record per submit. Use fictional data only. Valid region codes and plan rules are on
        the <Link href="/reference">Reference</Link> page.
      </p>
      {agent ? <IntakeForm /> : <p className="banner err">Please <Link href="/">sign in</Link> with your agent name first.</p>}
    </>
  );
}
