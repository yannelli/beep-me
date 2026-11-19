import { BookOpen, LogOut, Pause, Smartphone, Trash2 } from "lucide-react";
import { useMemo, useState } from "react";
import { isPaused, usePause } from "../components/PausedBanner";
import { CopyField, SelectField, TextField } from "../components/form";
import { ConfirmSheet } from "../components/Sheet";
import { Avatar, Button, Card, PageHeader, Skeleton } from "../components/ui";
import { copy } from "../copy";
import { Link } from "../lib/router";
import { api, errorMessage } from "../lib/api";
import { untilTime } from "../lib/format";
import { useToast } from "../lib/toast";
import { useSettings } from "./routing/useSettings";

function leave() {
  sessionStorage.clear();
  window.location.assign("/");
}

export function Settings() {
  const { me, save, saving } = useSettings();
  const { busy: pausing, pause } = usePause();
  const toast = useToast();
  const [signingOut, setSigningOut] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [typed, setTyped] = useState("");
  const deviceZone = Intl.DateTimeFormat().resolvedOptions().timeZone;
  const zones = useMemo(() => Intl.supportedValuesOf("timeZone"), []);

  if (!me) {
    return (
      <>
        <PageHeader title={copy.nav.settings} subtitle={copy.settings.subtitle} />
        <div className="space-y-4">
          <Skeleton className="h-24" />
          <Skeleton className="h-40" />
        </div>
      </>
    );
  }

  const timezone = me.settings.timezone;
  const zoneOptions = zones.includes(timezone) ? zones : [timezone, ...zones];

  async function signOut() {
    setSigningOut(true);
    try {
      await api.post("/auth/logout");
      leave();
    } catch (error) {
      toast(errorMessage(error), "error");
      setSigningOut(false);
    }
  }

  async function deleteAccount() {
    setDeleting(true);
    try {
      await api.del("/api/account");
      leave();
    } catch (error) {
      toast(errorMessage(error), "error");
      setDeleting(false);
    }
  }

  return (
    <>
      <PageHeader title={copy.nav.settings} subtitle={copy.settings.subtitle} />
      <div className="space-y-4">
        <Card title="Account">
          <div className="flex items-center gap-3">
            {me.user.avatarUrl ? <img src={me.user.avatarUrl} alt="" className="size-12 rounded-full" referrerPolicy="no-referrer" /> : <Avatar name={me.user.name ?? me.user.email} size={48} />}
            <div className="min-w-0 flex-1">
              <p className="truncate font-semibold">{me.user.name ?? me.user.email}</p>
              <p className="truncate text-sm text-muted">{me.user.email}</p>
            </div>
            <Button small busy={signingOut} onClick={() => void signOut()}>
              {!signingOut && <LogOut className="size-4" aria-hidden />}
              Sign out
            </Button>
          </div>
        </Card>

        <Card title={copy.docs.settingsTitle}>
          <p className="mb-3 text-sm text-muted">{copy.docs.settingsBody}</p>
          <Link href="/docs" className="inline-flex min-h-11 items-center gap-2 rounded-xl border border-line bg-raised px-3 text-sm font-medium hover:border-muted/60">
            <BookOpen className="size-4" aria-hidden />
            {copy.docs.readDocs}
          </Link>
        </Card>

        <Card title="Time zone">
          <div className="space-y-3">
            <SelectField label="Quiet hours and times use this zone" value={timezone} disabled={saving} onChange={(event) => void save({ timezone: event.target.value }, "Time zone saved.")}>
              {zoneOptions.map((zone) => (
                <option key={zone} value={zone}>
                  {zone.replaceAll("_", " ")}
                </option>
              ))}
            </SelectField>
            {deviceZone !== timezone && (
              <Button small onClick={() => void save({ timezone: deviceZone }, "Time zone saved.")}>
                Use this device's time zone ({deviceZone.replaceAll("_", " ")})
              </Button>
            )}
          </div>
        </Card>

        <Card title="Pause everything">
          <p className="mb-3 text-sm text-muted">{isPaused(me) ? `Paused until ${untilTime(me.settings.pausedUntil)}.` : copy.settings.pauseBody}</p>
          <div className="flex flex-wrap gap-2">
            <Button small disabled={pausing} onClick={() => void pause(60)}>
              <Pause className="size-4" aria-hidden />1 hour
            </Button>
            <Button small disabled={pausing} onClick={() => void pause(480)}>
              <Pause className="size-4" aria-hidden />8 hours
            </Button>
            {isPaused(me) && (
              <Button small variant="primary" busy={pausing} onClick={() => void pause(null)}>
                Resume
              </Button>
            )}
          </div>
        </Card>

        <Card title="MCP server URL">
          <p className="mb-3 text-sm text-muted">Agents connect to Beep Me with this URL.</p>
          <CopyField value={me.mcpUrl} label="MCP URL" />
        </Card>

        <Card title="Use Beep Me like an app">
          <p className="flex gap-3 text-sm text-muted">
            <Smartphone className="mt-0.5 size-5 shrink-0 text-accent" aria-hidden />
            {copy.settings.homeScreen}
          </p>
        </Card>

        <Card title="Delete account">
          <p className="mb-3 text-sm text-muted">{copy.settings.deleteBody}</p>
          <Button variant="danger" onClick={() => setConfirmDelete(true)}>
            <Trash2 className="size-4" aria-hidden />
            Delete account
          </Button>
        </Card>
      </div>

      <ConfirmSheet
        open={confirmDelete}
        onClose={() => {
          setConfirmDelete(false);
          setTyped("");
        }}
        title="Delete your account?"
        body={copy.settings.deleteBody}
        confirmLabel="Delete account"
        busy={deleting}
        disabled={typed.trim().toLowerCase() !== "delete"}
        onConfirm={() => void deleteAccount()}
      >
        <TextField label={copy.settings.deletePrompt} value={typed} onChange={(event) => setTyped(event.target.value)} autoComplete="off" autoCapitalize="off" />
      </ConfirmSheet>
    </>
  );
}
