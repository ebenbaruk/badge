import { MessageSquareDashed } from "lucide-react";
import type { Metadata } from "next";
import { WorkspaceIntro } from "@/components/agent/workspace-intro";
import { AgentComposer } from "@/components/agent/agent-composer";
import { TaskThread } from "@/components/agent/task-thread";
import { EnclaveUnavailable } from "@/components/enclave-unavailable";
import { EmptyState, PageHeader } from "@/components/page-header";
import { COMPROMISED_AGENT_TARGET, EMPLOYEES } from "@/lib/directory";
import { ofName } from "@/lib/format";
import { enclave } from "@/server/enclave";
import { employeeFromParams, load } from "@/server/load";

export const metadata: Metadata = { title: "Agent" };

export default async function AgentPage({ params }: { params: Promise<{ employee: string }> }) {
  const employee = await employeeFromParams(params);
  const tasks = await load(() => enclave().listTasks(employee.id));
  return (
    <div className="mx-auto max-w-5xl">
      <WorkspaceIntro firstName={employee.firstName} />
      <PageHeader
        title={`Agent ${ofName(employee.firstName)}`}
        eyebrow="Agent · mémoire confidentielle"
        description="Votre agent interroge la mémoire confidentielle de l'enclave. Le contexte global et le vôtre sont utilisables d'office ; celui d'un collègue ne sort qu'avec son accord, signé sur son Ledger."
      />
      <AgentComposer
        employee={employee.id}
        targetName={EMPLOYEES[COMPROMISED_AGENT_TARGET[employee.id]].firstName}
      />
      <div className="mt-12 space-y-12">
        {!tasks.ok ? (
          <EnclaveUnavailable failure={tasks} employee={employee.id} />
        ) : tasks.data.length === 0 ? (
          <EmptyState icon={<MessageSquareDashed />} title="Aucune tâche pour l'instant">
            Essayez « Prépare-moi le brief du rendez-vous de demain avec le client Orion ».
          </EmptyState>
        ) : (
          tasks.data.map((task) => <TaskThread key={task.id} task={task} requester={employee.id} />)
        )}
      </div>
    </div>
  );
}
