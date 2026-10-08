import { redirect } from "next/navigation";

/** Entry point of the demo (every "Ouvrir la démo" link): it opens on Alice's agent. */
export default function Demo(): never {
  redirect("/alice/agent");
}
