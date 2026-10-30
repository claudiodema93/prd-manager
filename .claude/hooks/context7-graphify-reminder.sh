#!/usr/bin/env bash
# UserPromptSubmit hook for this repository.
#
# Injects a mandatory reminder to use the context7 MCP server for library and
# framework documentation and the graphify skill for codebase questions.
#
# It prints the reminder once per session (keyed on the hook payload's
# session_id) so repeated prompts do not keep accumulating the same text in
# the context window. Any failure exits 0 with no output: a broken reminder
# must never block a prompt.

set -u

input=$(cat 2>/dev/null || true)

sid=""
if command -v jq >/dev/null 2>&1; then
  sid=$(printf '%s' "$input" | jq -r '.session_id // empty' 2>/dev/null || true)
fi
sid=$(printf '%s' "$sid" | tr -cd 'A-Za-z0-9._-')
[ -n "$sid" ] || sid="unknown"

state_dir="${TMPDIR:-/tmp}/claude-context7-graphify-reminder"
mkdir -p "$state_dir" 2>/dev/null || exit 0

stamp="$state_dir/$sid"
[ -f "$stamp" ] && exit 0
: >"$stamp" 2>/dev/null || exit 0

find "$state_dir" -type f -mtime +7 -delete >/dev/null 2>&1 || true

read -r -d '' message <<'TEXT'
PROJECT RULE (mandatory in this repo). (1) context7: for any question about a library, framework, SDK, API, or CLI tool, call the context7 MCP tools first (resolve-library-id, then query-docs) and answer from those docs, not from memory - even for well-known projects. (2) graphify: for any question about this codebase, its architecture, modules, or file relationships, use the graphify skill first (it loads or builds graphify-out/), then fall back to normal file search. Do not answer library questions from memory and do not start a codebase investigation with ad-hoc greps.
TEXT

# Strip newlines so the message stays a single valid JSON string.
message=$(printf '%s' "$message" | tr '\n' ' ')

printf '{"hookSpecificOutput":{"hookEventName":"UserPromptSubmit","additionalContext":"%s"}}\n' "$message"
