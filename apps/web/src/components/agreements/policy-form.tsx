"use client";

import { Loader2, PenLine } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useLedgerActivity } from "@/components/ledger/ledger-activity";
import { TEAMS, type EmployeeId } from "@/lib/directory";
import { createStandingAgreement } from "@/server/actions/agreements";

const DURATIONS = [7, 30, 90] as const;
const DEFAULT_DURATION_DAYS = 30;
const DEFAULT_MAX_LENGTH = 800;
const DEFAULT_PURPOSE = "client briefs";
/** The tag of the example above the form ("my Morpho notes"), preselected when the owner has it. */
const PREFERRED_CONTEXT_TAG = "morpho";

/**
 * Standing agreement form: "my Sales team may use my client notes for briefs, 30 days". Signed once on the
 * Ledger; every use is then logged and the agreement can be revoked at any time.
 */
export function PolicyForm({
  employee,
  ownTeam,
  tags,
}: {
  employee: EmployeeId;
  ownTeam: string;
  tags: readonly string[];
}) {
  const router = useRouter();
  const { runOnLedger, activity } = useLedgerActivity();
  const defaultTeam = TEAMS.find((team) => team !== ownTeam) ?? TEAMS[0];
  const [granteeTeam, setGranteeTeam] = useState<(typeof TEAMS)[number]>(defaultTeam);
  const [contextTag, setContextTag] = useState(
    tags.includes(PREFERRED_CONTEXT_TAG) ? PREFERRED_CONTEXT_TAG : (tags[0] ?? ""),
  );
  const [purpose, setPurpose] = useState(DEFAULT_PURPOSE);
  const [maxExcerptLength, setMaxExcerptLength] = useState(DEFAULT_MAX_LENGTH);
  const [durationDays, setDurationDays] = useState<number>(DEFAULT_DURATION_DAYS);
  const [busy, setBusy] = useState(false);

  const onSubmit = async (event: FormEvent): Promise<void> => {
    event.preventDefault();
    setBusy(true);
    await runOnLedger(
      `Standing agreement: ${granteeTeam} team, context "${contextTag}"`,
      () =>
        createStandingAgreement({
          employee,
          granteeTeam,
          contextTag,
          purpose,
          maxExcerptLength,
          durationDays,
        }),
      { success: () => "Standing agreement signed and recorded in the enclave." },
    );
    setBusy(false);
    router.refresh();
  };

  return (
    <form onSubmit={(event) => void onSubmit(event)} className="grid gap-4 sm:grid-cols-2">
      <div className="grid gap-1.5">
        <Label htmlFor="team">Allowed team</Label>
        <Select
          value={granteeTeam}
          onValueChange={(value) => setGranteeTeam(value as (typeof TEAMS)[number])}
        >
          <SelectTrigger id="team" className="w-full">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {TEAMS.map((team) => (
              <SelectItem key={team} value={team}>
                {team}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      <div className="grid gap-1.5">
        <Label htmlFor="tag">Shared context (tag)</Label>
        <Select value={contextTag} onValueChange={setContextTag}>
          <SelectTrigger id="tag" className="w-full">
            <SelectValue placeholder="Choose a tag" />
          </SelectTrigger>
          <SelectContent>
            {tags.map((tag) => (
              <SelectItem key={tag} value={tag}>
                {tag}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      <div className="grid gap-1.5">
        <Label htmlFor="purpose">Allowed purpose</Label>
        <Input id="purpose" value={purpose} maxLength={60} onChange={(e) => setPurpose(e.target.value)} />
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div className="grid gap-1.5">
          <Label htmlFor="max">Max per excerpt (chars)</Label>
          <Input
            id="max"
            type="number"
            min={50}
            max={4000}
            step={50}
            value={maxExcerptLength}
            onChange={(e) => setMaxExcerptLength(Number(e.target.value))}
          />
        </div>
        <div className="grid gap-1.5">
          <Label htmlFor="duration">Duration</Label>
          <Select value={String(durationDays)} onValueChange={(value) => setDurationDays(Number(value))}>
            <SelectTrigger id="duration" className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {DURATIONS.map((days) => (
                <SelectItem key={days} value={String(days)}>
                  {days} days
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>
      <div className="flex items-center justify-between gap-3 sm:col-span-2">
        <p className="text-xs text-muted-foreground">
          Signed once on your Ledger, revocable at any time, and every use is logged.
        </p>
        <Button
          type="submit"
          disabled={busy || activity !== null || contextTag === "" || purpose.trim().length < 3}
        >
          {busy ? <Loader2 className="animate-spin" /> : <PenLine />}
          {busy ? "Check your Ledger…" : "Sign the agreement on my Ledger"}
        </Button>
      </div>
    </form>
  );
}
