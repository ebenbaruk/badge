import type { Route } from "next";
import { redirect } from "next/navigation";
import { employeeFromParams } from "@/server/load";

export default async function EmployeeHome({ params }: { params: Promise<{ employee: string }> }) {
  const employee = await employeeFromParams(params);
  redirect(`/${employee.id}/agent` as Route);
}
