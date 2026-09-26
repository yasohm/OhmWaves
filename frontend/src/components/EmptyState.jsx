export default function EmptyState({ icon: Icon, title, children, action }) {
  return <div className="empty-state">
    {Icon && <span className="empty-state__icon"><Icon aria-hidden="true" /></span>}
    <h3>{title}</h3>
    {children && <p>{children}</p>}
    {action}
  </div>;
}
