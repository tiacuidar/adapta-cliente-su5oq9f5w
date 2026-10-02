import { useEffect, useState } from 'react'
import { Link, Outlet, useLocation } from 'react-router-dom'
import pb from '@/lib/pocketbase/client'
import { Button } from '@/components/ui/button'

/* Layout com navegação mínima (LT-1-T02) — header com links das áreas autenticadas. */

const NAV_ITENS = [
  { to: '/', label: 'Início' },
  { to: '/reunioes/nova', label: 'Registrar reunião' },
]

export default function Layout() {
  const [nome, setNome] = useState('')
  const [role, setRole] = useState('')
  const location = useLocation()

  useEffect(() => {
    const auth = pb.authStore.record
    setNome(String(auth?.name || auth?.email || ''))
    setRole(String(auth?.role || ''))
  }, [location.pathname])

  const sair = () => {
    pb.authStore.clear()
    window.location.href = '/login'
  }

  return (
    <div className="flex min-h-screen flex-col">
      <header className="border-b bg-background">
        <div className="container mx-auto flex h-14 items-center justify-between px-4">
          <div className="flex items-center gap-6">
            <Link to="/" className="font-semibold">
              Adapta Cliente
            </Link>
            <nav className="flex items-center gap-4 text-sm">
              {NAV_ITENS.map((item) => (
                <Link
                  key={item.to}
                  to={item.to}
                  className={
                    location.pathname === item.to
                      ? 'font-medium text-foreground'
                      : 'text-muted-foreground hover:text-foreground'
                  }
                >
                  {item.label}
                </Link>
              ))}
            </nav>
          </div>
          <div className="flex items-center gap-3">
            {role && (
              <span className="text-xs text-muted-foreground">
                {nome} · {role}
              </span>
            )}
            <Button variant="outline" size="sm" onClick={sair}>
              Sair
            </Button>
          </div>
        </div>
      </header>
      <main className="flex flex-1 flex-col">
        <Outlet />
      </main>
    </div>
  )
}
