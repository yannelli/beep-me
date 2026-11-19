import { ExternalLink, Terminal } from "lucide-react";
import type { SessionResponse } from "../../shared/api";
import { CopyField } from "../components/form";
import { Logo } from "../components/Shell";
import { copy } from "../copy";
import { nextPath } from "../lib/router";

const googleIcon = (
  <svg viewBox="0 0 24 24" className="size-5" aria-hidden>
    <path fill="#4285F4" d="M22.6 12.2c0-.8-.1-1.5-.2-2.2H12v4.2h5.9a5 5 0 0 1-2.2 3.3v2.7h3.6c2-1.9 3.3-4.7 3.3-8Z" />
    <path fill="#34A853" d="M12 23c3 0 5.5-1 7.3-2.7l-3.6-2.8c-1 .7-2.2 1.1-3.7 1.1-2.9 0-5.3-1.9-6.2-4.5H2.1v2.9A11 11 0 0 0 12 23Z" />
    <path fill="#FBBC05" d="M5.8 14.1a6.6 6.6 0 0 1 0-4.2V7H2.1a11 11 0 0 0 0 10l3.7-2.9Z" />
    <path fill="#EA4335" d="M12 5.4c1.6 0 3.1.6 4.2 1.7l3.2-3.2A11 11 0 0 0 2.1 7l3.7 2.9C6.7 7.3 9.1 5.4 12 5.4Z" />
  </svg>
);

function GoogleSetup({ redirectUri }: { redirectUri: string }) {
  const steps = copy.signIn.setupSteps;
  return (
    <section className="w-full rounded-2xl border border-line bg-surface p-5 text-left">
      <h2 className="text-lg font-semibold">{copy.signIn.setupTitle}</h2>
      <p className="mt-1 text-sm text-muted">{copy.signIn.setupBody}</p>
      <ol className="mt-5 space-y-5">
        {steps.map((step, index) => (
          <li key={step} className="flex gap-3">
            <span className="grid size-7 shrink-0 place-items-center rounded-full bg-accent-soft text-sm font-semibold text-accent">{index + 1}</span>
            <div className="min-w-0 flex-1 space-y-2.5 pt-0.5 text-[15px]">
              <p>{step}</p>
              {index === 0 && (
                <a
                  href="https://console.cloud.google.com/apis/credentials"
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex min-h-11 items-center gap-1.5 font-medium text-accent"
                >
                  {copy.signIn.consoleLink}
                  <ExternalLink className="size-4" aria-hidden />
                </a>
              )}
              {index === 2 && <CopyField value={redirectUri} label="redirect URI" multiline />}
              {index === 3 && (
                <div className="space-y-2">
                  <CopyField value="npx wrangler secret put GOOGLE_CLIENT_ID" label="command" multiline />
                  <CopyField value="npx wrangler secret put GOOGLE_CLIENT_SECRET" label="command" multiline />
                </div>
              )}
            </div>
          </li>
        ))}
      </ol>
    </section>
  );
}

export function SignIn({ session }: { session: SessionResponse }) {
  const { setup } = session;
  const params = new URLSearchParams({
    next: nextPath() ?? location.pathname + location.search,
    tz: Intl.DateTimeFormat().resolvedOptions().timeZone,
  });

  const devButton = setup.devLogin && (
    <a
      href={`/auth/dev?${params}`}
      className="flex min-h-12 w-full items-center justify-center gap-2 rounded-xl border border-line bg-raised px-4 font-medium hover:border-muted/60"
    >
      <Terminal className="size-4" aria-hidden />
      {copy.signIn.dev}
    </a>
  );

  return (
    <div className="pt-safe pb-safe">
      <main className="mx-auto flex min-h-dvh w-full max-w-md flex-col items-center justify-center gap-6 px-5 py-10 text-center">
        <div className="mb-2 flex flex-col items-center gap-4">
          <Logo size={56} />
          <div>
            <h1 className="text-2xl font-bold tracking-tight">{copy.signIn.title}</h1>
            <p className="mt-2 text-[15px] text-muted">{copy.signIn.body}</p>
          </div>
        </div>
        {setup.googleConfigured ? (
          <>
            <a
              href={`/auth/google/start?${params}`}
              className="flex min-h-12 w-full items-center justify-center gap-3 rounded-xl bg-white px-4 font-medium text-zinc-900 ring-1 ring-zinc-300 hover:bg-zinc-50"
            >
              {googleIcon}
              {copy.signIn.google}
            </a>
            {devButton}
          </>
        ) : (
          <>
            {devButton}
            <GoogleSetup redirectUri={setup.googleRedirectUri} />
          </>
        )}
        <a href={setup.googleConfigured ? "/docs" : "/docs/quickstart"} className="inline-flex min-h-11 items-center text-sm font-medium text-muted hover:text-fg">
          {copy.docs.readDocs}
        </a>
      </main>
    </div>
  );
}
