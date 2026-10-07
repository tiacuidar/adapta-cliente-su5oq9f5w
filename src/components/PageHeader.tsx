import React from 'react'

/* FA-5 — PageHeader no estilo NEXUS CONSULTORIA (projeto 48835): título grande com
   sublinhado curto em teal, subtítulo cinza e botão de ação à direita. */

interface PageHeaderProps {
  title: string
  subtitle?: string
  action?: React.ReactNode
}

export function PageHeader({ title, subtitle, action }: PageHeaderProps) {
  return (
    <div className="flex flex-col md:flex-row md:items-center justify-between pb-4 mb-6 border-b border-gray-200 gap-4">
      <div>
        <h1 className="text-2xl font-bold text-[#0c0c0c] tracking-tight relative pb-1">
          {title}
          <span className="absolute bottom-0 left-0 w-12 h-1 bg-[var(--brand-primary)] rounded-full" />
        </h1>
        {subtitle && <p className="text-sm text-[#6c6c6c] mt-1">{subtitle}</p>}
      </div>
      {action && <div className="flex items-center gap-2">{action}</div>}
    </div>
  )
}
