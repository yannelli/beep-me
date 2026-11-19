import { useRef, useState } from "react";
import type { MeResponse, MessageDTO, MessagePage } from "../../shared/api";
import { PausedBanner } from "../components/PausedBanner";
import { PageHeader, Skeleton } from "../components/ui";
import { copy } from "../copy";
import { setQueryData, useQuery } from "../lib/query";
import { navigate, useLocation } from "../lib/router";
import { Checklist, checklistDone } from "./activity/Checklist";
import { Feed, feedKey, type Filters } from "./activity/Feed";
import { MessageSheet } from "./activity/MessageSheet";
import { SendTest } from "./activity/SendTest";

export function Activity() {
  const me = useQuery<MeResponse>("/api/me");
  const { search } = useLocation();
  const [filters, setFilters] = useState<Filters>({ priority: "", agent: "", status: "" });
  const [selected, setSelected] = useState<MessageDTO | null>(null);
  const testButton = useRef<HTMLButtonElement>(null);
  const linkedId = search.get("message");
  const openId = selected?.id ?? linkedId;

  function closeSheet() {
    setSelected(null);
    if (linkedId) navigate("/", { replace: true });
  }

  function onTestSent(message: MessageDTO) {
    setQueryData<MessagePage>(feedKey({ priority: "", agent: "", status: "" }), (page) => ({
      items: [message, ...(page?.items ?? []).filter((item) => item.id !== message.id)],
      nextBefore: page?.nextBefore ?? null,
    }));
    setFilters({ priority: "", agent: "", status: "" });
  }

  function focusTest() {
    testButton.current?.scrollIntoView({ behavior: "smooth", block: "center" });
    testButton.current?.focus({ preventScroll: true });
  }

  return (
    <>
      <PageHeader title={copy.nav.activity} subtitle={copy.activity.subtitle} />
      <div className="space-y-4">
        <PausedBanner me={me.data} />
        {!me.data && <Skeleton className="h-28" />}
        {me.data && !checklistDone(me.data) && <Checklist me={me.data} onSendTest={focusTest} />}
        <SendTest ref={testButton} onSent={onTestSent} />
        <Feed filters={filters} setFilters={setFilters} onOpen={setSelected} />
      </div>
      <MessageSheet id={openId} initial={selected} onClose={closeSheet} />
    </>
  );
}
