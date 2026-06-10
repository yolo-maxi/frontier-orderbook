import { useApp } from "../state/app";

export function Toasts() {
  const { toasts } = useApp();
  if (toasts.length === 0) return null;
  return (
    <div className="toasts">
      {toasts.map((t) => (
        <div key={t.id} className={`toast toast-${t.status}`}>
          <span className="toast-icon">
            {t.status === "pending" ? (
              <span className="spinner" />
            ) : t.status === "success" ? (
              "✓"
            ) : (
              "✕"
            )}
          </span>
          <div>
            <div className="toast-label">{t.label}</div>
            {t.detail && <div className="toast-detail num">{t.detail}</div>}
          </div>
          {t.status !== "pending" && <span className="toast-progress" />}
        </div>
      ))}
    </div>
  );
}
