import type { ReactNode } from "react";

/**
 * Remounted on every navigation between employee screens (unlike the layout), so each screen rises in
 * with the brand's route transition. A `router.refresh()` keeps the same template: no replay while polling.
 */
export default function EmployeeTemplate({ children }: { children: ReactNode }) {
  return <div className="animate-route-in">{children}</div>;
}
