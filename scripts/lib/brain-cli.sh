# Sourced, not executed. Defines `brain` for the harness scripts: the CLI on PATH
# when there is one, else the pinned brain-axi through npx. One pin, one runner,
# so brain-setup.sh and harness-check.sh never disagree about which CLI exists.
#
# BRAIN_AXI_SPEC overrides the pin (e.g. a commit, before a tag is cut).

BRAIN_AXI_SPEC="${BRAIN_AXI_SPEC:-github:SeanningTatum/brain-axi#v0.3.0}"

if command -v brain >/dev/null 2>&1; then
  brain() { command brain "$@"; }
else
  brain() { npx -y "$BRAIN_AXI_SPEC" "$@"; }
fi
