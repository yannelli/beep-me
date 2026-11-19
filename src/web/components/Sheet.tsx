import { X } from "lucide-react";
import { useEffect, useId, useRef, type ReactNode } from "react";

export function Sheet({
  open,
  onClose,
  title,
  children,
  footer,
}: {
  open: boolean;
  onClose: () => void;
  title: ReactNode;
  children: ReactNode;
  footer?: ReactNode;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();

  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (open && !dialog.open) dialog.showModal();
    if (!open && dialog.open) dialog.close();
  }, [open]);

  return (
    <dialog
      ref={ref}
      className="sheet"
      aria-labelledby={titleId}
      onCancel={(event) => {
        event.preventDefault();
        onClose();
      }}
      onClick={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div className="flex max-h-[inherit] flex-col">
        <header className="flex items-center justify-between gap-3 border-b border-line px-4 py-2 pl-5">
          <h2 id={titleId} className="min-w-0 truncate text-[17px] font-semibold">
            {title}
          </h2>
          <button type="button" onClick={onClose} className="-mr-1 grid size-11 place-items-center rounded-xl text-muted hover:bg-raised hover:text-fg" aria-label="Close">
            <X className="size-5" aria-hidden />
          </button>
        </header>
        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-5 py-4">{open && children}</div>
        {footer && open && <footer className="pb-safe-3 border-t border-line px-5 pt-3">{footer}</footer>}
        {!footer && <div className="pb-safe" />}
      </div>
    </dialog>
  );
}

export function ConfirmSheet({
  open,
  onClose,
  title,
  body,
  confirmLabel,
  onConfirm,
  busy,
  children,
  disabled,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  body: ReactNode;
  confirmLabel: string;
  onConfirm: () => void;
  busy?: boolean;
  children?: ReactNode;
  disabled?: boolean;
}) {
  return (
    <Sheet open={open} onClose={onClose} title={title}>
      <div className="space-y-4">
        <p className="text-[15px] text-muted">{body}</p>
        {children}
        <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <button type="button" onClick={onClose} className="min-h-11 rounded-xl border border-line bg-raised px-4 font-medium">
            Cancel
          </button>
          <button
            type="button"
            onClick={onConfirm}
            disabled={busy || disabled}
            className="min-h-11 rounded-xl bg-danger px-4 font-medium text-white disabled:opacity-50"
          >
            {busy ? "Wait…" : confirmLabel}
          </button>
        </div>
      </div>
    </Sheet>
  );
}
