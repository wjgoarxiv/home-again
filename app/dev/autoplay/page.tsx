import { notFound } from "next/navigation";
import { DevAutoplay } from "./DevAutoplay";

export const metadata = { title: "Autoplay (dev)" };

/** Dev only: the whole guided demo on synthetic data, so it can be watched without spending Qloo calls. */
export default function AutoplayDevPage() {
  if (process.env.NODE_ENV === "production") notFound();
  return <DevAutoplay />;
}
