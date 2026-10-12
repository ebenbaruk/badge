/**
 * Desks and exchange rules of the directory, read from the same dataset the enclave loads (infra/seed/coinbase.json).
 * The directory is configuration, not context: it says who belongs to which desk and which desk may ask what of
 * which other desk. The enclave enforces the rules; the web app only needs them to lay out the desks screen.
 */
import { z } from "zod";
import seedDataset from "../../../../infra/seed/coinbase.json";
import { DESK_IDS, type DeskId } from "@/lib/directory";

const deskIdSchema = z.enum(DESK_IDS);

const directorySchema = z.object({
  desks: z.array(
    z.object({
      id: deskIdSchema,
      members: z.array(z.string()),
      allowedTopics: z.array(z.string()),
    }),
  ),
  exchangeRules: z.array(
    z.object({
      id: z.string(),
      label: z.string(),
      sourceDesk: deskIdSchema,
      recipientDesk: deskIdSchema,
      allowedTags: z.array(z.string()),
    }),
  ),
});

export interface DeskDirectoryEntry {
  id: DeskId;
  /** Everyone the directory lists in the desk (each joins its group with their own Ledger). */
  directoryMembers: number;
  allowedTopics: string[];
}

export interface ExchangeRule {
  id: string;
  /** Device ASCII, as signed in DeskShare messages. */
  label: string;
  sourceDesk: DeskId;
  recipientDesk: DeskId;
  allowedTags: string[];
}

const directory = directorySchema.parse(seedDataset);

export const DESK_DIRECTORY: readonly DeskDirectoryEntry[] = directory.desks.map((desk) => ({
  id: desk.id,
  directoryMembers: desk.members.length,
  allowedTopics: desk.allowedTopics,
}));

export const EXCHANGE_RULES: readonly ExchangeRule[] = directory.exchangeRules;
