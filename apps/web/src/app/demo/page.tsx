import { redirect } from "next/navigation";

/** Entry point of the demo (every "Open the demo" link): it opens on Alice's agent. */
export default function Demo(): never {
  redirect("/alice/agent");
}
