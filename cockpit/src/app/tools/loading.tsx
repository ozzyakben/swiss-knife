import { LoadingState } from "@/components/LoadingState";

// Segment loading UI for the DB-backed, force-dynamic tool pages — shows
// immediate feedback during a route transition instead of a blank/frozen view
// while the server query resolves.
export default function Loading() {
  return (
    <div className="flex min-h-[40vh] items-center justify-center">
      <LoadingState />
    </div>
  );
}
