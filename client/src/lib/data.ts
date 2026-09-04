/** Oxbridge Ledger: cache-aware static release loading; no private or generated content enters the runtime. */
import type { ReleaseCatalogue, SegmentRelease } from "@/types";

const RELEASE_SCHEMA_VERSION = 3;

function releaseUrl(filename: string, releaseVersion?: string): string {
  const url = new URL(`data/releases/${filename}`, document.baseURI);
  if (releaseVersion) url.searchParams.set("v", releaseVersion);
  return url.toString();
}

async function fetchJson<T>(url: string, cache: RequestCache): Promise<T> {
  const response = await fetch(url, { cache });
  if (!response.ok) {
    throw new Error(`Release data could not be loaded (${response.status}).`);
  }
  return (await response.json()) as T;
}

export async function loadCatalogue(): Promise<ReleaseCatalogue> {
  const catalogue = await fetchJson<ReleaseCatalogue>(
    releaseUrl("catalog.json"),
    "no-store",
  );
  if (
    catalogue.schemaVersion !== RELEASE_SCHEMA_VERSION ||
    catalogue.collections.length !== 7
  ) {
    throw new Error("The release catalogue has an unsupported format.");
  }
  return catalogue;
}

export async function loadSegment(
  filename: string,
  releaseVersion: string,
): Promise<SegmentRelease> {
  const segment = await fetchJson<SegmentRelease>(
    releaseUrl(filename, releaseVersion),
    "default",
  );
  if (
    segment.schemaVersion !== RELEASE_SCHEMA_VERSION ||
    segment.releaseVersion !== releaseVersion
  ) {
    throw new Error("The question data and catalogue versions do not match.");
  }
  return segment;
}
