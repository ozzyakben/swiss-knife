// Segment loading UI for the DB-backed, force-dynamic tool pages — shows
// immediate feedback during a route transition instead of a blank/frozen view
// while the server query resolves.
export default function Loading() {
  return (
    <div className="flex min-h-[40vh] items-center justify-center">
      <div className="flex items-center gap-2 text-sm text-muted-foreground">
        <span className="h-4 w-4 animate-spin rounded-full border-2 border-muted-foreground/30 border-t-muted-foreground" />
        Loading…
      </div>
    </div>
  );
}
