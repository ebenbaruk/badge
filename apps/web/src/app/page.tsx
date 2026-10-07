import { redirect } from "next/navigation";

/** The demo opens on Alice's agent. */
export default function Home(): never {
  redirect("/alice/agent");
}
