import { cn } from "@/lib/utils";

const styles: Record<string, string> = {
  critical: "bg-[#fee2e2] text-[#991b1b]",
  high: "bg-[#fdecc8] text-[#7a5c14]",
  medium: "bg-[#fef3c7] text-[#92400e]",
  low: "bg-[#d1f5f9] text-[#0e7490]",
  info: "bg-[#ececec] text-[#525252]",
};

export function SeverityBadge({ severity }: { severity: string }) {
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full px-2.5 py-0.5 text-[0.7rem] font-semibold capitalize",
        styles[severity] ?? styles.info,
      )}
    >
      {severity}
    </span>
  );
}
