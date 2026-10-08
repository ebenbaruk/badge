import { EMPLOYEES, type EmployeeId } from "@/lib/directory";
import { cn } from "@/lib/utils";

/**
 * One pastel art-card tint per demo employee (fixed in both themes, like the reference's cards) so the
 * presenter always knows whose screen is shown.
 */
const AVATAR_TINTS: Readonly<Record<EmployeeId, string>> = {
  alice: "bg-periwinkle text-periwinkle-ink ring-black/5",
  bob: "bg-peach text-peach-ink ring-black/5",
  chloe: "bg-lavender text-lavender-ink ring-black/5",
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
        "inline-flex shrink-0 items-center justify-center rounded-full font-semibold tracking-[-0.02em] ring-1 ring-inset",
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
