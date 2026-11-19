import * as p from "@clack/prompts";
import type { Writable } from "node:stream";

let output: Writable = process.stdout;

/** JSON mode keeps stdout for the JSON document. */
export function logToStderr(): void {
  output = process.stderr;
}

const useColor = (): boolean => Boolean((output as NodeJS.WriteStream).isTTY) && !process.env.NO_COLOR;
const paint = (code: number) => (text: string) => (useColor() ? `\x1b[${code}m${text}\x1b[22m\x1b[39m` : text);
export const bold = paint(1);
export const dim = paint(2);
export const green = paint(32);
export const yellow = paint(33);
export const red = paint(31);
export const cyan = paint(36);

export const say = {
  intro: (title: string) => p.intro(bold(title), { output }),
  outro: (text: string) => p.outro(text, { output }),
  step: (text: string) => p.log.step(bold(text), { output }),
  info: (text: string) => p.log.info(text, { output }),
  ok: (text: string) => p.log.success(text, { output }),
  skip: (text: string) => p.log.message(dim(text), { output, symbol: dim("-") }),
  warn: (text: string) => p.log.warn(text, { output }),
  error: (text: string) => p.log.error(text, { output }),
  note: (body: string, title?: string) => p.note(body, title, { output }),
  /** Unboxed lines, so long commands copy as one line. */
  block: (title: string, body: string) => {
    p.log.step(bold(title), { output });
    output.write(`${body.split("\n").map((line) => `   ${line}`).join("\n")}\n`);
  },
  command: (text: string) => p.log.message(dim(`$ ${text}`), { output, symbol: dim("|") }),
  dryRun: (text: string) => p.log.message(`${yellow("dry run, skipped:")} ${text}`, { output, symbol: yellow("o") }),
};

function unwrap<T>(value: T | symbol): T {
  if (p.isCancel(value)) {
    p.cancel("Stopped. The steps that finished stay in place.");
    process.exit(130);
  }
  return value as T;
}

export interface Choice<T> {
  value: T;
  label: string;
  hint?: string;
}

export const prompt = {
  confirm: async (message: string, initialValue = true): Promise<boolean> => unwrap<boolean>(await p.confirm({ message, initialValue })),
  text: async (message: string, options: { initial?: string; placeholder?: string; validate?: (value: string) => string | undefined } = {}): Promise<string> =>
    unwrap<string>(
      await p.text({
        message,
        initialValue: options.initial,
        placeholder: options.placeholder,
        validate: options.validate ? (value) => options.validate?.((value ?? "").trim()) : undefined,
      }),
    ).trim(),
  password: async (message: string): Promise<string> =>
    unwrap<string>(await p.password({ message, validate: (value) => (value?.trim() ? undefined : "Paste a value, or press Ctrl+C to stop.") })).trim(),
  select: async <T>(message: string, options: Choice<T>[], initialValue?: T): Promise<T> =>
    unwrap<T>(await p.select<T>({ message, options: options as never, initialValue, maxItems: 12 })),
};

export function spin(text: string): { done: (text: string) => void; fail: (text: string) => void } {
  if (!process.stdout.isTTY || output !== process.stdout) {
    say.info(text);
    return { done: (message) => say.ok(message), fail: (message) => say.error(message) };
  }
  const spinner = p.spinner({ output });
  spinner.start(text);
  return { done: (message) => spinner.stop(message), fail: (message) => spinner.error(message) };
}

export function table(rows: Record<string, unknown>[], columns: string[]): string {
  if (!rows.length) return dim("None.");
  const cells = rows.map((row) => columns.map((column) => String(row[column] ?? "")));
  const widths = columns.map((column, index) => Math.max(column.length, ...cells.map((cell) => cell[index].length)));
  const line = (values: string[]) => values.map((value, index) => value.padEnd(widths[index])).join("  ").trimEnd();
  return [bold(line(columns)), ...cells.map(line)].join("\n");
}

export function ago(ms: number | null | undefined): string {
  if (!ms) return "never";
  const minutes = Math.round((Date.now() - ms) / 60_000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes}m ago`;
  if (minutes < 2880) return `${Math.round(minutes / 60)}h ago`;
  return `${Math.round(minutes / 1440)}d ago`;
}
