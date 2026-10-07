/**
 * Inventory of the context ingested in the enclave, per owner. The memory layer answers "what is relevant to this
 * task" (semantic search); the inventory answers "how much context does each owner have" and "what is ALL of it",
 * which the mass-extraction rules, the token statistics and an explicit full-context request need.
 *
 * It is built from the same notes the enclave ingested into memory (for the demo: the seed dataset), so it never
 * holds anything memory does not.
 */
import { excerptLength } from "@badge/consent";
import { COMPANY_OWNER_ID } from "../memory/types";

export interface InventoryNote {
  readonly id: string;
  readonly ownerId: string;
  readonly text: string;
  readonly tags: readonly string[];
}

export class ContextInventory {
  readonly #byOwner = new Map<string, InventoryNote[]>();

  constructor(notes: readonly InventoryNote[]) {
    for (const note of notes) {
      const list = this.#byOwner.get(note.ownerId) ?? [];
      list.push(note);
      this.#byOwner.set(note.ownerId, list);
    }
  }

  /** Every note of `ownerId`, in ingestion order (empty for an owner without context). */
  notesOf(ownerId: string): readonly InventoryNote[] {
    return this.#byOwner.get(ownerId) ?? [];
  }

  /** The company context and every employee's context. */
  allNotes(): InventoryNote[] {
    return [...this.#byOwner.values()].flat();
  }

  /** Personal owners (every owner but the company). */
  personalOwners(): string[] {
    return [...this.#byOwner.keys()].filter((owner) => owner !== COMPANY_OWNER_ID);
  }

  /** Size of `ownerId`'s whole context in characters (code points, like `excerptLength`). */
  totalLength(ownerId: string): number {
    return this.notesOf(ownerId).reduce((sum, note) => sum + excerptLength(note.text), 0);
  }
}
