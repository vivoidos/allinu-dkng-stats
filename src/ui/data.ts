// The page shows snapshot.json, the numbers scripts/snapshot.ts computed (on GitHub Actions, for the
// published page). It is the page's only data.

import { useQuery } from "@tanstack/react-query";
import type { Snapshot } from "../core/stats/index.ts";

async function fetchSnapshot(): Promise<Snapshot> {
  const res = await fetch("snapshot.json", { cache: "no-store" });
  if (!res.ok) throw new Error(`snapshot.json: HTTP ${res.status}`);
  return (await res.json()) as Snapshot;
}

export const useSnapshot = () => useQuery({ queryKey: ["snapshot"], queryFn: fetchSnapshot });
