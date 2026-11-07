import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";

/** Menu do botao direito compartilhado pelo carrinho e pelas tabelas do financeiro. */
export function ContextMenu({ x, y, children, onClose, label }: { x: number; y: number; children: ReactNode; onClose: () => void; label?: string }) {
  const menuRef = useRef<HTMLDivElement | null>(null);
  const [position, setPosition] = useState({ left: Math.max(8, x), top: Math.max(8, y) });
  useEffect(() => {
    const close = () => onClose();
    window.addEventListener("click", close);
    window.addEventListener("keydown", close);
    window.addEventListener("wheel", close, { passive: true });
    return () => {
      window.removeEventListener("click", close);
      window.removeEventListener("keydown", close);
      window.removeEventListener("wheel", close);
    };
  }, [onClose]);

  useLayoutEffect(() => {
    const reposition = () => {
      const bounds = menuRef.current?.getBoundingClientRect();
      const width = bounds?.width || 260;
      const height = bounds?.height || 380;
      setPosition({
        left: Math.max(8, Math.min(x, window.innerWidth - width - 8)),
        top: Math.max(8, Math.min(y, window.innerHeight - height - 8))
      });
    };
    reposition();
    window.addEventListener("resize", reposition);
    return () => window.removeEventListener("resize", reposition);
  }, [x, y]);

  // Portal no body: janelas internas com transform deslocariam um menu position:fixed.
  return createPortal(
    <div ref={menuRef} role="menu" aria-label={label} className="pdv-context-menu" style={position} onClick={(event) => event.stopPropagation()} onContextMenu={(event) => event.preventDefault()}>
      {children}
    </div>,
    document.body
  );
}

export type ContextAction = {
  label: string;
  onSelect: () => void;
  disabled?: boolean;
  /** Motivo exibido ao passar o mouse quando a acao esta desabilitada. */
  reason?: string;
  danger?: boolean;
};
