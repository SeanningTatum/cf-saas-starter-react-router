export const EXIT_OK = 0;
export const EXIT_FAIL = 1;

export const COMMIT_SHA_PATTERN = /^[0-9a-f]{7,64}$/;
export const RELEASE_TAG_PATTERN = /^v(\d+)\.(\d+)\.(\d+)$/;
export const TAG_REF_PREFIX = "refs/tags/";
export const LINE_BREAK = "\n";
export const FIELD_BREAK = /\s+/;
export const OUTPUT_KEY = "version";

export const USAGE = "usage: release-version.ts <commit sha>   (tag listing on stdin: one '<sha> refs/tags/<name>' per line)";
export const BAD_SHA = "::error::the commit to deploy is not a hex sha, so no release version can be named";
