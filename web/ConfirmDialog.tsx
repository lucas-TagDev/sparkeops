import { t as tx, getLanguage } from "./i18n.ts";
import {
  useEffect,
  useId,
  useRef,
  useSyncExternalStore,
  useState,
} from "react";
import { ShieldCheck, X } from "lucide-react";

type ConfirmOptions = {
  confirmationWord?: string;
  destructive?: boolean;
  title?: string;
};
type Request = ConfirmOptions & {
  message: string;
  resolve: (confirmed: boolean) => void;
};
const queue: Request[] = [];
const subscribers = new Set<() => void>();
const notify = () => subscribers.forEach((fn) => fn());
export function confirmAction(
  message: string,
  options: ConfirmOptions = {},
): Promise<boolean> {
  return new Promise((resolve) => {
    queue.push({ message, resolve, ...options });
    notify();
  });
}
function finish(confirmed: boolean) {
  const request = queue.shift();
  request?.resolve(confirmed);
  notify();
}
const subscribe = (fn: () => void) => {
  subscribers.add(fn);
  return () => {
    subscribers.delete(fn);
  };
};
const snapshot = () => queue[0] ?? null;

export function ConfirmDialog() {
  const [typed, setTyped] = useState<{
    request: Request | null;
    value: string;
  }>({ request: null, value: "" });
  const request = useSyncExternalStore(subscribe, snapshot, snapshot),
    dialog = useRef<HTMLDialogElement>(null),
    cancel = useRef<HTMLButtonElement>(null),
    previousFocus = useRef<HTMLElement | null>(null),
    title = useId(),
    description = useId();
  const confirmation = typed.request === request ? typed.value : "",
    canConfirm =
      !request?.confirmationWord || confirmation === request.confirmationWord;
  useEffect(() => {
    if (request) {
      previousFocus.current = document.activeElement as HTMLElement;
      dialog.current?.showModal();
      cancel.current?.focus();
    } else if (dialog.current?.open) {
      dialog.current.close();
      previousFocus.current?.focus();
    }
  }, [request]);
  return (
    <dialog
      ref={dialog}
      className="app-confirm-dialog"
      aria-labelledby={title}
      aria-describedby={description}
      onCancel={(e) => {
        e.preventDefault();
        finish(false);
      }}
    >
      <div className="app-confirm-heading">
        <span className="app-confirm-icon">
          <ShieldCheck size={23} />
        </span>
        <button
          type="button"
          className="icon-button"
          aria-label={tx("Fechar confirmação")}
          onClick={() => finish(false)}
        >
          <X size={18} />
        </button>
      </div>
      <h2 id={title}>{request?.title ?? tx("Confirmar ação")}</h2>
      <p id={description} className="app-confirm-description">
        {request?.message}
      </p>
      {request?.confirmationWord && (
        <label className="typed-confirm-label">
          {tx`Digite ${request.confirmationWord} para confirmar`}
          <input
            value={confirmation}
            onChange={(e) => setTyped({ request, value: e.target.value })}
            autoComplete="off"
            spellCheck={false}
            autoCapitalize="off"
            placeholder={request.confirmationWord}
            aria-required="true"
          />
        </label>
      )}
      <div className="app-confirm-actions">
        <button
          ref={cancel}
          type="button"
          className="secondary"
          onClick={() => finish(false)}
        >
          {tx("Cancelar")}
        </button>
        <button
          type="button"
          className={request?.destructive ? "danger" : "primary"}
          disabled={!canConfirm}
          onClick={() => {
            if (canConfirm) finish(true);
          }}
        >
          {tx("Confirmar")}
        </button>
      </div>
    </dialog>
  );
}
