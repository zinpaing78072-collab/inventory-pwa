import type { ReactNode } from "react";

/** Phone-style bottom sheet with mask and grab handle. */
export function BottomSheet({
  title,
  sub,
  onClose,
  children,
}: {
  title?: string;
  sub?: string;
  onClose: () => void;
  children: ReactNode;
}) {
  return (
    <>
      <div className="sheetmask" onClick={onClose} data-close />
      <div className="sheet">
        <div className="grab" />
        {title && <h3>{title}</h3>}
        {sub && <div className="sub">{sub}</div>}
        {children}
      </div>
    </>
  );
}
