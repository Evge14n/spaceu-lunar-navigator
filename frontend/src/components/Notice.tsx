import type { ReactNode } from 'react'

export function Notice({ tone = 'info', title, children }: { tone?: 'info' | 'error'; title: string; children?: ReactNode }) {
  return (
    <div className={`notice notice-${tone}`} role={tone === 'error' ? 'alert' : 'status'}>
      <strong>{title}</strong>
      {children && <div>{children}</div>}
    </div>
  )
}
