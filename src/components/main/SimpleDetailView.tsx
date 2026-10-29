import type { ReactNode } from 'react'
import { Breadcrumb } from './Breadcrumb'

/**
 * Header shell for selections that have no ancestry and no tabs, namespaces and
 * object types. Keeps them inside the same navigation frame as element detail so
 * the "Overview" home crumb is always reachable.
 */
export function SimpleDetailView({
  label,
  kind,
  children,
}: {
  label: string
  kind: string
  children: ReactNode
}) {
  return (
    <div className="flex-1 min-h-0 flex flex-col bg-i3x-bg">
      <header className="bg-i3x-surface border-b border-i3x-border px-3 sm:px-5 pt-3.5 pb-4">
        <Breadcrumb label={label} />
        <div className="flex items-baseline gap-3 mt-2 min-w-0">
          <h1 className="text-lg sm:text-xl font-semibold text-i3x-text truncate" title={label}>
            {label}
          </h1>
          <span className="text-xs text-i3x-text-muted flex-shrink-0">{kind}</span>
        </div>
      </header>

      <div className="flex-1 overflow-auto p-3 sm:p-5 min-h-0">
        <div className="max-w-[960px]">{children}</div>
      </div>
    </div>
  )
}
