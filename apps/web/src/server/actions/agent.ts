"use server";
/**
 * Agent runtime actions: the employee's agent turns a typed task into an enclave task request.
 */
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { COMPROMISED_AGENT_TARGET, type EmployeeId } from "@/lib/directory";
import { enclave, type TaskView } from "../enclave";
import { runAction, type ActionResult } from "../errors";
import { employeeIdSchema, taskTextSchema } from "./schemas";

const TASK_LABEL_WORDS = 4;

/**
 * Short device label of a task ("Orion brief"): the device shows it as "Task". Derived from the main nouns of
 * the request; the enclave folds it to ASCII and caps its length.
 */
function taskLabelOf(task: string): string {
  const orion = /orion/i.test(task);
  if (orion && /brief|meeting/i.test(task)) return "Orion brief";
  const words = task
    .replace(/[^\p{L}\p{N}\s'-]/gu, " ")
    .split(/\s+/)
    .filter((w) => w.length > 3);
  return words.slice(0, TASK_LABEL_WORDS).join(" ") || "task";
}

const startTaskSchema = z.object({
  employee: employeeIdSchema,
  task: taskTextSchema,
  compromised: z.boolean(),
});

export async function startTask(input: {
  employee: EmployeeId;
  task: string;
  compromised: boolean;
}): Promise<ActionResult<TaskView>> {
  return runAction(async () => {
    const { employee, task, compromised } = startTaskSchema.parse(input);
    const view = await enclave().createTask(employee, {
      task,
      taskLabel: taskLabelOf(task),
      ...(compromised ? { trap: { requestFullContextOf: COMPROMISED_AGENT_TARGET[employee] } } : {}),
    });
    revalidatePath(`/${employee}`, "layout");
    return view;
  });
}
