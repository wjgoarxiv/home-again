import { z } from "zod";

export const SeedSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  city: z.string().optional(),
});

export const AreaSchema = z.object({
  name: z.string().min(1),
  lat: z.number().min(-90).max(90),
  lng: z.number().min(-180).max(180),
});

const Ids = z.array(z.string().min(1)).max(50);

export const JourneyStateSchema = z.object({
  seed: SeedSchema,
  area: AreaSchema,
  week: z.union([z.literal(1), z.literal(2), z.literal(3)]),
  liked: Ids,
  crowded: Ids,
  rejected: Ids,
  seen: Ids,
  shown: Ids,
  loves: z.record(z.string(), z.number().int().min(0)),
  regular: z.string().nullable(),
  done: z.boolean(),
});

export const VerdictSchema = z.enum(["love", "crowded", "meh"]);

export const FeedbackSchema = z.array(z.object({ id: z.string().min(1), verdict: VerdictSchema })).max(3);

export const CardSchema = z.object({
  entityId: z.string().min(1),
  name: z.string().min(1),
  distanceM: z.number().nonnegative(),
  address: z.string().optional(),
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
