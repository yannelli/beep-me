import { lazy, Suspense, useEffect, useState } from "react";
import type { SessionResponse } from "../shared/api";
import { Logo } from "./components/Shell";
import { Shell } from "./components/Shell";
import { Button, ErrorBox } from "./components/ui";
import { errorMessage, UNAUTHORIZED_EVENT } from "./lib/api";
import { fetchQuery, useQuery } from "./lib/query";
import { matchPath, nextPath, useLocation } from "./lib/router";
import { useToast } from "./lib/toast";
import { Activity } from "./screens/Activity";
import { AgentDetail } from "./screens/AgentDetail";
import { Agents } from "./screens/Agents";
import { ChannelDetail } from "./screens/ChannelDetail";
import { Channels } from "./screens/Channels";
import { NotFound } from "./screens/NotFound";
import { Routing } from "./screens/Routing";
import { Settings } from "./screens/Settings";
import { SignIn } from "./screens/SignIn";

const DocsApp = lazy(() => import("./docs/DocsApp"));

function Screen() {
  const { path } = useLocation();
  if (path === "/") return <Activity />;
  if (matchPath("/channels", path)) return <Channels />;
  const channel = matchPath("/channels/:id", path);
  if (channel) return <ChannelDetail key={channel.id} id={channel.id!} />;
  if (matchPath("/agents", path)) return <Agents />;
  const agent = matchPath("/agents/:id", path);
  if (agent) return <AgentDetail key={agent.id} id={agent.id!} />;
  if (matchPath("/routing", path)) return <Routing />;
  if (matchPath("/settings", path)) return <Settings />;
  return <NotFound />;
}

function Splash() {
  return (
    <div className="grid min-h-dvh place-items-center" role="status" aria-label="Loading">
      <div className="animate-pulse">
        <Logo size={48} />
      </div>
    </div>
  );
}

const notices: Record<string, string> = {
  signin: "You canceled Google sign-in. Try again when you are ready.",
  gmail: "Google did not give Beep Me access to Gmail. Try again.",
};

function useRedirectNotices() {
  const toast = useToast();
  useEffect(() => {
    const url = new URL(location.href);
    let changed = false;
    for (const [param, text] of Object.entries(notices)) {
      if (url.searchParams.get(param) !== "denied") continue;
      toast(text, "error");
      url.searchParams.delete(param);
      changed = true;
    }
    if (changed) history.replaceState(null, "", url.pathname + url.search);
  }, [toast]);
}

export function App() {
  const { path } = useLocation();
  const session = useQuery<SessionResponse>("/api/session");
  const [signedOut, setSignedOut] = useState(false);
  useRedirectNotices();
  const next = nextPath();
  const leaving = Boolean(session.data?.user && !signedOut && next);

  useEffect(() => {
    if (leaving && next) window.location.assign(next);
  }, [leaving, next]);

  useEffect(() => {
    const onUnauthorized = () => {
      setSignedOut(true);
      void fetchQuery("/api/session");
    };
    window.addEventListener(UNAUTHORIZED_EVENT, onUnauthorized);
    return () => window.removeEventListener(UNAUTHORIZED_EVENT, onUnauthorized);
  }, []);

  if (path === "/docs" || path.startsWith("/docs/")) {
    return (
      <Suspense fallback={<Splash />}>
        <DocsApp />
      </Suspense>
    );
  }
  if (!session.data) {
    if (!session.error) return <Splash />;
    return (
      <div className="mx-auto grid min-h-dvh max-w-md place-items-center px-4">
        <div className="w-full space-y-4">
          <ErrorBox error={errorMessage(session.error)} />
          <Button variant="primary" className="w-full" onClick={() => void session.refetch()} busy={session.loading}>
            Try again
          </Button>
        </div>
      </div>
    );
  }
  if (!session.data.user || signedOut) return <SignIn session={session.data} />;
  if (leaving) return <Splash />;
  return (
    <Shell>
      <Screen />
    </Shell>
  );
}
