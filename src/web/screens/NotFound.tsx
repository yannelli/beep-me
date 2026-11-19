import { Compass } from "lucide-react";
import { EmptyState } from "../components/ui";
import { Link } from "../lib/router";

export function NotFound() {
  return (
    <EmptyState
      icon={<Compass className="size-6" aria-hidden />}
      title="Page not found"
      body="This page does not exist."
      action={
        <Link href="/" className="inline-flex min-h-11 items-center rounded-xl bg-accent px-4 font-medium text-accent-fg">
          Go to Activity
        </Link>
      }
    />
  );
}
