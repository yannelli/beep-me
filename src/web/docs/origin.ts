/** Docs write the deployment address as this token. The docs site shows the address the reader is on. */
export const ORIGIN_TOKEN = "https://your-beep-me.example";

export function withOrigin(text: string): string {
  return text.includes(ORIGIN_TOKEN) ? text.split(ORIGIN_TOKEN).join(location.origin) : text;
}
