import { cn } from "@/lib/utils";

/** value: 0 ~ 1 */
function Progress({ value, className }: { value: number; className?: string }) {
  return (
    <div
      role="progressbar"
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={Math.round(value * 100)}
      className={cn("h-1.5 w-full overflow-hidden rounded-full bg-muted", className)}
    >
      <div className="h-full bg-primary transition-[width]" style={{ width: `${Math.round(value * 100)}%` }} />
    </div>
  );
}

export { Progress };
