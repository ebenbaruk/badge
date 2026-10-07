import { EMPLOYEES, type EmployeeId } from "@/lib/directory";
import { cn } from "@/lib/utils";

/** One calm, distinct tint per demo employee so the presenter always knows whose screen is shown. */
const AVATAR_TINTS: Readonly<Record<EmployeeId, string>> = {
  alice: "bg-sky-500/15 text-sky-700 ring-sky-500/25 dark:text-sky-300",
  bob: "bg-emerald-500/15 text-emerald-700 ring-emerald-500/25 dark:text-emerald-300",
  chloe: "bg-violet-500/15 text-violet-700 ring-violet-500/25 dark:text-violet-300",
};

export function EmployeeAvatar({
  employee,
  size = "md",
  className,
}: {
  employee: EmployeeId;
  size?: "sm" | "md" | "lg";
  className?: string;
}) {
  return (
    <span
      aria-hidden
      className={cn(
        "inline-flex shrink-0 items-center justify-center rounded-full font-semibold ring-1 ring-inset",
        size === "sm" && "size-6 text-[10px]",
        size === "md" && "size-8 text-[11px]",
        size === "lg" && "size-10 text-sm",
        AVATAR_TINTS[employee],
        className,
      )}
    >
      {EMPLOYEES[employee].initials}
    </span>
  );
}
