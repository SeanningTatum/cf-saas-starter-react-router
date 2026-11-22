import { FIX_LEAD } from "./constants";
import type { Finding } from "./types";

const TRAILING_STOP = /[.\s]+$/;

export function formatFinding(finding: Finding): string {
  const what = finding.message.replace(TRAILING_STOP, "");
  const fix = finding.fix.replace(TRAILING_STOP, "");
  const see = finding.example ? ` See ${finding.example}.` : "";
  return `${finding.file}:${finding.line} ${finding.rule}: ${what}. ${FIX_LEAD} ${fix}.${see}`;
}
