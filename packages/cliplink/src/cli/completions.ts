import { COMMANDS, FLAGS, flagsFor, SHELLS, type Command, type FlagSpec, type Shell } from "./args.ts";

/**
 * `cliplink completions <shell>` — a completion script, built from the same
 * tables the parser reads, so it offers exactly the flags each command takes.
 *
 * A room code is completed from `cliplink rooms --codes`, which prints
 * well-formed codes and nothing else, and no script evaluates what it prints. Keys are never offered: a completion is shown on screen
 * and may be recorded with it, and `rooms` withholds keys for that reason.
 */

/** The commands worth offering. `help` and `version` are better reached as flags. */
const OFFERED = COMMANDS.filter((command) => command.usage !== null);

const ROOM_CODES = "cliplink rooms --codes 2>/dev/null";

function spellings(flag: FlagSpec) {
  return [flag.name, ...(flag.short ? [flag.short] : [])];
}

/** The first line of a flag's help, for the shells that show one. */
function summary(flag: FlagSpec) {
  return flag.help.split("\n")[0];
}

/** `text` as one single-quoted shell word. */
function quote(text: string) {
  return `'${text.replaceAll("'", `'\\''`)}'`;
}

function caseLabel(names: readonly string[]) {
  return names.join("|");
}

/** The flags that take a value, split by whether there is anything to offer for it. */
function valueFlags() {
  const rooms = FLAGS.filter((flag) => flag.value && flag.complete === "rooms");
  const other = FLAGS.filter((flag) => flag.value && flag.complete !== "rooms");
  return { rooms: rooms.flatMap(spellings), other: other.flatMap(spellings) };
}

function bash() {
  const { rooms, other } = valueFlags();
  const commandNames = OFFERED.map((command) => command.name);
  const flagCases = OFFERED.map(
    (command) =>
      `    ${command.name}) words=${quote(flagsFor(command.name).map((flag) => flag.name).join(" "))} ;;`,
  ).join("\n");

  return `# cliplink completion for bash.
# Load it from ~/.bashrc with:  source <(cliplink completions bash)

_cliplink() {
  local cur="\${COMP_WORDS[COMP_CWORD]}"
  local prev="\${COMP_WORDS[COMP_CWORD-1]}"
  local cmd="" words="" i

  for ((i = 1; i < COMP_CWORD; i++)); do
    case "\${COMP_WORDS[i]}" in
      ${caseLabel(commandNames)}) cmd="\${COMP_WORDS[i]}"; break ;;
    esac
  done

  case "$prev" in
    ${caseLabel(rooms)})
      # Matched by hand rather than through compgen -W, which expands its word
      # list — a $(…) in it would run. The codes come from a file, and only
      # what was typed is compared against them.
      COMPREPLY=()
      local code
      while IFS= read -r code; do
        [[ "$code" == "$cur"* ]] && COMPREPLY+=("$code")
      done < <(${ROOM_CODES})
      return ;;
    ${caseLabel(other)})
      return ;;
  esac

  if [[ "$cur" == -* ]]; then
    case "$cmd" in
${flagCases}
    *) words=${quote(flagsFor("help").map((flag) => flag.name).join(" "))} ;;
    esac
  elif [[ -z "$cmd" ]]; then
    words=${quote(commandNames.join(" "))}
  elif [[ "$cmd" == completions ]]; then
    words=${quote(SHELLS.join(" "))}
  fi

  COMPREPLY=($(compgen -W "$words" -- "$cur"))
}

complete -F _cliplink cliplink
`;
}

function zsh() {
  const { rooms, other } = valueFlags();
  const commandNames = OFFERED.map((command) => command.name);
  const described = (entries: Array<[string, string]>) =>
    entries.map(([name, text]) => `      ${quote(`${name}:${text}`)}`).join("\n");
  const flagEntries = (command: Command) =>
    described(flagsFor(command).map((flag) => [flag.name, summary(flag)]));
  const flagCases = OFFERED.map(
    (command) => `    (${command.name})\n      flags=(\n${flagEntries(command.name)}\n      ) ;;`,
  ).join("\n");

  return `#compdef cliplink
# cliplink completion for zsh.
# Save it as _cliplink in a directory on $fpath, or load it from ~/.zshrc
# after compinit with:  source <(cliplink completions zsh)

_cliplink() {
  local cur=\${words[CURRENT]} prev=\${words[CURRENT-1]} cmd="" i
  local -a commands flags

  for (( i = 2; i < CURRENT; i++ )); do
    case \${words[i]} in
      (${caseLabel(commandNames)}) cmd=\${words[i]}; break ;;
    esac
  done

  case $prev in
    (${caseLabel(rooms)})
      compadd -- \${(f)"$(${ROOM_CODES})"}
      return ;;
    (${caseLabel(other)})
      return ;;
  esac

  if [[ $cur == -* ]]; then
    case $cmd in
${flagCases}
    (*)
      flags=(
${flagEntries("help")}
      ) ;;
    esac
    _describe -t options option flags
  elif [[ -z $cmd ]]; then
    commands=(
${described(OFFERED.map((command) => [command.name, command.summary]))}
    )
    _describe -t commands command commands
  elif [[ $cmd == completions ]]; then
    compadd -- ${SHELLS.join(" ")}
  fi
}

if [[ $zsh_eval_context[-1] == loadautofunc ]]; then
  _cliplink "$@"
else
  compdef _cliplink cliplink
fi
`;
}

function fish() {
  const commandNames = OFFERED.map((command) => command.name).join(" ");
  const lines = [
    "# cliplink completion for fish.",
    "# Save it as ~/.config/fish/completions/cliplink.fish, or run:",
    "#   cliplink completions fish | source",
    "",
    "complete -c cliplink -f",
    ...OFFERED.map(
      (command) =>
        `complete -c cliplink -n ${quote(`not __fish_seen_subcommand_from ${commandNames}`)} -a ${command.name} -d ${quote(command.summary)}`,
    ),
    `complete -c cliplink -n ${quote("__fish_seen_subcommand_from completions")} -a ${quote(SHELLS.join(" "))}`,
    ...FLAGS.map((flag) => {
      const parts = ["complete -c cliplink"];
      if (flag.commands) {
        parts.push(`-n ${quote(`__fish_seen_subcommand_from ${flag.commands.join(" ")}`)}`);
      }
      parts.push(`-l ${flag.name.slice(2)}`);
      if (flag.short) {
        parts.push(`-s ${flag.short.slice(1)}`);
      }
      if (flag.value) {
        // -x: takes a value, and the value is not a file name.
        parts.push("-x");
        if (flag.complete === "rooms") {
          parts.push(`-a ${quote(`(${ROOM_CODES})`)}`);
        }
      }
      parts.push(`-d ${quote(summary(flag))}`);
      return parts.join(" ");
    }),
    "",
  ];
  return lines.join("\n");
}

export function completionScript(shell: Shell): string {
  if (shell === "bash") {
    return bash();
  }
  return shell === "zsh" ? zsh() : fish();
}
