export { fixtureCommitment, registerDeskFixtures } from "./fixtures";
export {
  DeskMemberRepository,
  DeskRequestRepository,
  SqliteNullifierRegistry,
  type DeskOfferRow,
  type DeskRequestRow,
} from "./repository";
export {
  CreateDeskRequestSchema,
  DESK_SHARE_TTL_SECONDS,
  DeskService,
  type CreateDeskRequestInput,
  type DeskDelivery,
  type DeskRequestStatus,
  type DeskRequestView,
  type DeskServiceDeps,
  type DeskView,
  type PendingDeskShareView,
} from "./service";
