import { useT } from '@/i18n';
import { useTodos } from './todos-state.js';

const STATUS_COLORS = {
  pending: '#9ca3af',
  in_progress: '#f59e0b',
  completed: '#10b981',
};

export function TodosPanel() {
  const t = useT();
  const { todos } = useTodos();
  if (todos.length === 0) return null;
  return (
    <aside
      style={{
        position: 'fixed',
        right: 16,
        top: 80,
        width: 280,
        maxHeight: '60vh',
        overflowY: 'auto',
        background: '#fff',
        border: '1px solid #e5e7eb',
        borderRadius: 8,
        padding: 12,
        boxShadow: '0 4px 12px rgba(0,0,0,0.08)',
        fontSize: 13,
        fontFamily: 'system-ui',
      }}
    >
      <div style={{ fontWeight: 600, marginBottom: 8 }}>{t('todos.title')}</div>
      {todos.map((t) => (
        <div
          key={t.id}
          style={{ display: 'flex', alignItems: 'flex-start', gap: 6, padding: '4px 0' }}
        >
          <span
            style={{
              width: 8,
              height: 8,
              borderRadius: '50%',
              background: STATUS_COLORS[t.status],
              marginTop: 6,
              flexShrink: 0,
            }}
          />
          <span
            style={{
              textDecoration: t.status === 'completed' ? 'line-through' : 'none',
              opacity: t.status === 'completed' ? 0.5 : 1,
            }}
          >
            {t.content}
          </span>
        </div>
      ))}
    </aside>
  );
}
