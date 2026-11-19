#!/usr/bin/env bash
# Updates a Beep Me checkout that has no `bun run upgrade` (v0.1.0 to v0.5.0), then hands off to it.
set -euo pipefail

say() { printf '%s\n' "$*"; }
fail() { printf 'Stopped: %s\n' "$*" >&2; exit "${code:-1}"; }
run() {
  if [ "$dry_run" = 1 ]; then say "dry run, skipped: $*"; else "$@"; fi
}
has_tty() { (: </dev/tty) 2>/dev/null; }

usage() {
  say "Run it in your Beep Me folder:"
  say "  curl -fsSL https://raw.githubusercontent.com/yannelli/beep-me/main/scripts/upgrade.sh | bash"
  say "Options: --yes, --dry-run, --no-deploy, --remote <name>. With curl, add them after bash -s --"
}

main() {
  dry_run=0 yes=0 no_deploy=0 remote=""
  while [ $# -gt 0 ]; do
    case "$1" in
      --dry-run) dry_run=1 ;;
      --yes | -y) yes=1 ;;
      --no-deploy) no_deploy=1 ;;
      --remote) remote="${2:?--remote needs a name}"; shift ;;
      --help | -h) usage; exit 0 ;;
      *) usage >&2; code=2 fail "unknown option $1" ;;
    esac
    shift
  done

  command -v git >/dev/null || fail "git is not installed."
  command -v node >/dev/null || fail "Node is not installed. Install Node 24 or later from https://nodejs.org."
  [ "$(node -p 'process.versions.node.split(".")[0]')" -ge 24 ] || fail "Beep Me needs Node 24 or later. This is Node $(node -v)."
  command -v bun >/dev/null || fail "Bun is not installed. Install it with: curl -fsSL https://bun.sh/install | bash
Then open a new terminal and run this command again."

  root="$(git rev-parse --show-toplevel 2>/dev/null)" || fail "run this command inside your Beep Me folder."
  cd "$root"
  [ "$(node -p 'require("./package.json").name' 2>/dev/null)" = "beep-me" ] || fail "$root is not a Beep Me checkout."

  if [ -z "$remote" ]; then
    if git remote | grep -qx upstream; then remote=upstream; else remote=origin; fi
  fi
  git remote | grep -qx "$remote" || fail "this checkout has no git remote named $remote."

  current="$(node -p 'require("./package.json").version')"
  say "Reading releases from $remote ($(git remote get-url "$remote"))"
  git fetch --quiet --tags "$remote" || fail "git fetch from $remote failed."
  tag="$(git ls-remote --tags --refs "$remote" | node -e '
    const tags = (require("fs").readFileSync(0, "utf8").match(/refs\/tags\/v\d+\.\d+\.\d+$/gm) ?? []).map((ref) => ref.slice(10));
    const key = (tag) => tag.slice(1).split(".").map(Number);
    tags.sort((a, b) => { const x = key(a), y = key(b); return x[0] - y[0] || x[1] - y[1] || x[2] - y[2]; });
    console.log(tags.pop() ?? "");')"
  [ -n "$tag" ] || fail "$remote has no release tags."
  newer="$(node -e 'const [a, b] = process.argv.slice(1).map((v) => v.replace(/^v/, "").split(".").map(Number)); console.log(a[0] - b[0] || a[1] - b[1] || a[2] - b[2])' "$tag" "$current")"
  if [ "$newer" -le 0 ]; then
    say "Beep Me v$current is up to date. The newest release is $tag."
    exit 0
  fi

  # The migration code comes from the release, or from the default branch before the first release that has it.
  source_ref="$tag"
  git cat-file -e "$source_ref:scripts/cli/legacy.ts" 2>/dev/null || source_ref="$remote/HEAD"
  git cat-file -e "$source_ref:scripts/cli/legacy.ts" 2>/dev/null || source_ref="$remote/main"
  git cat-file -e "$source_ref:scripts/cli/legacy.ts" 2>/dev/null || fail "$remote has no scripts/cli/legacy.ts yet. Wait for the next release."
  tmp="$(mktemp -d)"
  trap 'rm -rf "$tmp"' EXIT
  git show "$source_ref:scripts/cli/legacy.ts" >"$tmp/legacy.ts"
  git show "$source_ref:scripts/cli/overlay.ts" >"$tmp/overlay.ts"

  git merge-base --is-ancestor HEAD "$tag" || fail "this checkout has commits that are not in $tag:
$(git log --oneline "$tag..HEAD")
Move them onto the release with git rebase $tag, then run this command again."
  edited="$(git status --porcelain=v1 --untracked-files=no | cut -c4- | grep -vx -e wrangler.jsonc -e package-lock.json -e bun.lock || true)"
  [ -z "$edited" ] || fail "these files have local edits:
$edited
Commit them, or put them away with git stash. Then run this command again."

  say ""
  say "Update Beep Me from v$current to $tag. Release notes: https://github.com/yannelli/beep-me/blob/$tag/CHANGELOG.md"
  say "This command does these steps:"
  node "$tmp/legacy.ts" "$root" --dry-run || fail "wrangler.jsonc has edits that .beep-me/deploy.json cannot hold. Undo these edits and keep the IDs and emails there. Then run this command again."
  say "  Move the code to $tag (git fast-forward)"
  say "  Install packages with bun install"
  has_upgrade=0
  git cat-file -e "$tag:scripts/cli/upgrade.ts" 2>/dev/null && has_upgrade=1
  if [ "$has_upgrade" = 1 ]; then next=(bun run upgrade --continue --from "$current"); else next=(bun run cli deploy); fi
  if [ "$no_deploy" = 1 ]; then say "  Skip the deploy (--no-deploy)"; else say "  Build and deploy with ${next[*]}. It asks before it deploys."; fi

  if [ "$dry_run" = 0 ] && [ "$yes" = 0 ]; then
    has_tty || code=2 fail "no terminal to ask in. Add --yes to accept the steps above: curl ... | bash -s -- --yes"
    printf 'Continue? [y/N] ' >/dev/tty
    read -r answer </dev/tty
    case "$answer" in y | Y | yes) ;; *) say "Stopped. Nothing changed."; exit 0 ;; esac
  fi

  run node "$tmp/legacy.ts" "$root"
  if git symbolic-ref -q HEAD >/dev/null; then run git merge --ff-only --quiet "$tag"; else run git checkout --quiet "$tag"; fi
  run bun install

  if [ "$no_deploy" = 1 ]; then
    if [ "$has_upgrade" = 0 ]; then say "Code updated to $tag. Run bun run cli deploy to finish."; exit 0; fi
    next+=(--no-deploy)
  fi
  if [ "$yes" = 1 ]; then next+=(--yes); fi
  if [ "$dry_run" = 1 ]; then
    say "dry run, skipped: ${next[*]}"
  elif has_tty; then
    exec "${next[@]}" </dev/tty
  else
    exec "${next[@]}"
  fi
}

main "$@"
