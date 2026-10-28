import { z } from "zod";

export const SeedSchema = z.object({
  id: z.string().min(1).max(100),
  name: z.string().min(1).max(120),
  city: z.string().max(60).optional(),
  /** Qloo tag names of the seed café, used to ground each card's taste link. */
  tags: z.array(z.string().min(1).max(80)).max(200).optional(),
});

export const AreaSchema = z.object({
  name: z.string().min(1).max(60),
  lat: z.number().min(-90).max(90),
  lng: z.number().min(-180).max(180),
});

const Id = z.string().min(1).max(100);
const Ids = z.array(Id).max(50);

/** What the app keeps of a café it showed, so a loved one can come back when Qloo leaves out its own signal. */
export const SavedCafeSchema = z.object({
  id: Id,
  name: z.string().min(1).max(200),
  lat: z.number().min(-90).max(90),
  lng: z.number().min(-180).max(180),
  address: z.string().max(300).optional(),
  affinity: z.number().nullable(),
  tags: z.array(z.string().min(1).max(80)).max(200),
  photoUrl: z.string().max(500).regex(/^https:\/\//).optional(),
  priceLevel: z.number().int().min(1).max(4).optional(),
  blurb: z.string().max(200).optional(),
  hours: z.record(z.string().max(12), z.string().max(40)).optional(),
});

export const JourneyStateSchema = z.object({
  seed: SeedSchema,
  area: AreaSchema,
  week: z.union([z.literal(1), z.literal(2), z.literal(3)]),
  liked: Ids,
  crowded: Ids,
  rejected: Ids,
  seen: Ids,
  shown: Ids,
  saved: z.array(SavedCafeSchema).max(12).default([]),
  loves: z.record(Id, z.number().int().min(0)),
  regular: Id.nullable(),
  done: z.boolean(),
});

export const VerdictSchema = z.enum(["love", "crowded", "meh"]);

export const FeedbackSchema = z.array(z.object({ id: z.string().min(1), verdict: VerdictSchema })).max(3);

export const CardSchema = z.object({
  entityId: z.string().min(1),
  name: z.string().min(1),
  distanceM: z.number().nonnegative(),
  address: z.string().optional(),
  lat: z.number(),
  lng: z.number(),
  affinity: z.number().nullable(),
  photoUrl: z.string().max(500).optional(),
  hoursToday: z.string().max(40).optional(),
  priceLevel: z.number().int().min(1).max(4).optional(),
  blurb: z.string().max(200).optional(),
  tasteLink: z.array(z.string().min(1)).max(4),
  unknowns: z.array(z.string().min(1)).max(3),
  why: z.string().min(1).max(240),
  revisit: z.boolean().default(false),
});

export type Seed = z.infer<typeof SeedSchema>;
export type Area = z.infer<typeof AreaSchema>;
export type JourneyState = z.infer<typeof JourneyStateSchema>;
export type Verdict = z.infer<typeof VerdictSchema>;
export type Feedback = z.infer<typeof FeedbackSchema>;
export type Card = z.infer<typeof CardSchema>;

export function parseJourneyState(input: unknown): JourneyState {
  return JourneyStateSchema.parse(input);
}
