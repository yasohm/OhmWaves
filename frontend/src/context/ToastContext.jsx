import { createContext, useCallback, useContext, useMemo, useRef, useState } from 'react';
import { CheckCircle2, AlertCircle, X } from 'lucide-react';

const ToastContext = createContext(null);

export function ToastProvider({ children }) {
  const [toasts, setToasts] = useState([]);
  const idRef = useRef(0);

  const dismiss = useCallback((id) => setToasts((list) => list.filter((t) => t.id !== id)), []);

  const notify = useCallback((message, { tone = 'info', action, duration = 3500 } = {}) => {
    idRef.current += 1;
    const id = idRef.current;
    setToasts((list) => [...list.slice(-2), { id, message, tone, action }]);
    if (duration) setTimeout(() => dismiss(id), duration);
    return id;
  }, [dismiss]);

  const value = useMemo(() => ({ notify, dismiss }), [notify, dismiss]);

  return <ToastContext.Provider value={value}>
    {children}
    <div className="toast-region" role="status" aria-live="polite">
      {toasts.map((toast) => <div key={toast.id} className={`toast toast--${toast.tone}`}>
        {toast.tone === 'error' ? <AlertCircle aria-hidden="true" /> : <CheckCircle2 aria-hidden="true" />}
        <span>{toast.message}</span>
        {toast.action && <button type="button" className="toast__action" onClick={() => { toast.action.onClick(); dismiss(toast.id); }}>{toast.action.label}</button>}
        <button type="button" className="toast__close" onClick={() => dismiss(toast.id)} aria-label="Dismiss notification"><X /></button>
      </div>)}
    </div>
  </ToastContext.Provider>;
}

export const useToast = () => useContext(ToastContext);
