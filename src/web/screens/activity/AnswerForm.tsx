import { useState } from "react";
import type { MessageDTO } from "../../../shared/api";
import { Button } from "../../components/ui";
import { api, errorMessage } from "../../lib/api";
import { useToast } from "../../lib/toast";

/** Lets you answer from the dashboard. Useful for Slack, Discord, and Pushover, which cannot carry a reply back. */
export function AnswerForm({ message, onAnswered }: { message: MessageDTO; onAnswered: () => void }) {
  const toast = useToast();
  const [text, setText] = useState("");
  const [busy, setBusy] = useState<number | "text" | null>(null);

  async function send(body: { option?: number; text?: string }, key: number | "text") {
    setBusy(key);
    try {
      await api.post(`/api/messages/${message.id}/answer`, body);
      setText("");
      toast("Answer sent. The agent gets it the next time it checks for replies.");
      onAnswered();
    } catch (error) {
      toast(errorMessage(error), "error");
    } finally {
      setBusy(null);
    }
  }

  return (
    <section className="space-y-3 rounded-xl border border-line p-3">
      <h3 className="text-sm font-semibold">Answer</h3>
      {message.options.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {message.options.map((option, index) => (
            <Button key={option} small busy={busy === index} disabled={busy !== null} onClick={() => void send({ option: index }, index)}>
              {option}
            </Button>
          ))}
        </div>
      )}
      <form
        className="flex gap-2"
        onSubmit={(event) => {
          event.preventDefault();
          if (text.trim()) void send({ text }, "text");
        }}
      >
        <label htmlFor={`answer-${message.id}`} className="sr-only">
          Your answer
        </label>
        <input
          id={`answer-${message.id}`}
          value={text}
          onChange={(event) => setText(event.target.value)}
          placeholder={message.options.length ? "Or write an answer" : "Write an answer"}
          maxLength={4000}
          className="min-h-11 min-w-0 flex-1 rounded-xl border border-line bg-bg px-3 text-[15px] outline-none focus:border-accent"
        />
        <Button type="submit" variant="primary" small busy={busy === "text"} disabled={busy !== null || !text.trim()}>
          Send
        </Button>
      </form>
    </section>
  );
}
