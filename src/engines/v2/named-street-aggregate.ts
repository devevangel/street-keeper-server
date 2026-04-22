/**
 * CityStrides / V2: aggregate multiple OSM segments that share one street name.
 *
 * - **Display %** — length-weighted mean of per-way node-hit percentages; short
 *   "connector" segments count at CONNECTOR_WEIGHT (same as homepage map).
 * - **Status "completed"** — only when **every** segment is V2-complete (`isWayComplete`),
 *   not when weighted ratio crosses an arbitrary 95–98% bar (that disagreed with CS-style per-way rules).
 */

import { STREET_AGGREGATION } from "../../config/constants.js";

export type SegmentProgress = {
  lengthMeters: number;
  /** 0–100 from node hits / total nodes on that way */
  percentage: number;
  status: "completed" | "partial" | "not_started";
};

export function v2AggregatedStatusFromSegments(
  segments: SegmentProgress[],
): {
  percentage: number;
  status: "completed" | "partial" | "not_started";
} {
  if (segments.length === 0) {
    return { percentage: 0, status: "not_started" };
  }

  const { CONNECTOR_MAX_LENGTH_METERS, CONNECTOR_WEIGHT } = STREET_AGGREGATION;

  let weightedSum = 0;
  let totalWeight = 0;
  for (const s of segments) {
    const isConnector = s.lengthMeters <= CONNECTOR_MAX_LENGTH_METERS;
    const weight = s.lengthMeters * (isConnector ? CONNECTOR_WEIGHT : 1);
    weightedSum += (s.percentage / 100) * weight;
    totalWeight += weight;
  }
  const weightedCompletionRatio =
    totalWeight === 0 ? 0 : weightedSum / totalWeight;
  const weightedPercentage = Math.round(weightedCompletionRatio * 100);

  const allComplete = segments.every((s) => s.status === "completed");
  const status: "completed" | "partial" | "not_started" = allComplete
    ? "completed"
    : weightedPercentage > 0
      ? "partial"
      : "not_started";

  return { percentage: weightedPercentage, status };
}
