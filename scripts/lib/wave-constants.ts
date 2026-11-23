export const WAVE_STATE_VERSION = 1;
export const VERIFY_DIR = ".verify";
export const STATE_FILE_NAME = "wave.json";
export const MESSAGE_PREFIX = "wave:";

export const EXIT_OK = 0;
export const EXIT_BAD_INPUT = 1;
export const EXIT_USAGE = 2;
export const EXIT_GH = 3;

export const TICKET_KINDS = ["design", "build", "mechanical"] as const;
export const TICKET_STATUSES = ["queued", "open", "green", "merged", "stuck", "skipped"] as const;
export const FIX_KINDS = ["review", "check", "threads", "refresh"] as const;
export const GATE_RESULTS = ["", "pass", "fail"] as const;
export const GUARD_VERDICTS = ["green", "red", "pending", "threads", "closed", "merged"] as const;

export const MAX_CHECK_FAILURES = 2;
export const MAX_THREAD_ROUNDS = 3;
export const MAX_PENDING_ROUNDS = 6;
export const MAX_GATE_FAILURES = 2;
export const MAX_MERGE_PASSES = 2;
export const MAX_TICKETS = 60;
export const MAX_TEXT = 500;
export const MAX_LIST = 50;
export const SIGNATURE_MAX = 160;
export const LOG_TAIL_LINES = 15;
export const DEFAULT_WAIT_SECONDS = 0;
export const MAX_WAIT_SECONDS = 540;
export const POLL_SECONDS = 30;
export const MS_PER_SECOND = 1000;

export const TRACK_PREFIX = "t";
export const PASSING_CONCLUSIONS = ["SUCCESS", "SKIPPED"] as const;
export const PENDING_STATES = ["PENDING", "EXPECTED", "QUEUED", "IN_PROGRESS", "WAITING", "REQUESTED"] as const;
export const COMPLETED_STATUS = "COMPLETED";
export const OPEN_STATE = "OPEN";
export const MERGED_STATE = "MERGED";
export const CONFLICTING = "CONFLICTING";

export const PR_VIEW_FIELDS = "state,baseRefName,headRefName,headRefOid,isCrossRepository,mergeable,statusCheckRollup";
export const REPO_VIEW_ARGS = ["repo", "view", "--json", "owner,name", "-q", '.owner.login + "/" + .name'];
export const THREADS_QUERY =
  "query($owner:String!,$name:String!,$pr:Int!){repository(owner:$owner,name:$name){pullRequest(number:$pr){reviewThreads(first:100){nodes{isResolved comments(first:100){nodes{author{login} url}}}}}}}";

export const SIGNATURE_HEX = /\b(?=[0-9]*[a-f])[0-9a-f]{7,40}\b/g;
export const SIGNATURE_DIGITS = /\d+/g;
export const SIGNATURE_PATHS = /(?:\/[^\s/:'"]+)+\//g;
export const SIGNATURE_SPACE = /\s+/g;
export const SLUG_PATTERN = /^[a-z0-9]+(-[a-z0-9]+)*$/;
export const BRANCH_PATTERN = /^(?!.*\.\.)(?!-)[A-Za-z0-9._/-]+$/;
export const SHA_PATTERN = /^[0-9a-f]{40}$/;

export const VERB_PLAN = "plan";
export const VERB_APPROVE = "approve";
export const VERB_NEXT = "next";
export const VERB_EVENT = "event";
export const VERB_GUARD = "guard";
export const VERB_MERGE = "merge";
export const VERB_GATE = "gate";
export const VERB_ROLLUP = "rollup";
export const VERB_STATUS = "status";
export const VERB_PAUSE = "pause";
export const VERB_RESUME = "resume";
export const VERB_RETRY = "retry";
export const VERB_SKIP = "skip";
export const USAGE_TEXT =
  "usage: bun scripts/wave.ts plan <slug> --wave <branch> --into <branch> --tracks <n> --review-rounds <n> (tickets JSON on stdin) | approve <slug> | next <slug> | event <slug> (event JSON on stdin) | guard <slug> <ticket> [--wait <seconds>] | merge <slug> | gate <slug> --head <sha> --code <n> [--log <path>] | rollup <slug> --title <text> | status <slug> [--json] | pause <slug> | resume <slug> | retry <slug> <ticket> | skip <slug> <ticket>";
