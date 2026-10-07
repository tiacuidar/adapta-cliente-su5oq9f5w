import { useEffect, useRef, useState } from 'react'
import { Link, Outlet, useLocation } from 'react-router-dom'
import pb from '@/lib/pocketbase/client'
import { LogOut } from 'lucide-react'

/* FA-5 — Layout no estilo NEXUS CONSULTORIA (projeto 48835, AdminLayout):
   sidebar escura fixa (#141614) com marca + nav com ícones + card do usuário,
   conteúdo claro bg-slate-50. Rotas, guard e RLS por perfil/empresa NÃO mudam —
   apenas a apresentação. "Registrar reunião" permanece aba própria. */

const NAV_ITENS = [
  { to: '/farol', label: 'Farol das unidades', icon: '🚦' },
  { to: '/avaliacao', label: 'Avaliação PECAF/PEDHE', icon: '📋' },
  { to: '/reunioes/nova', label: 'Registrar reunião', icon: '🎥' },
  { to: '/fila', label: 'Fila de ocorrências', icon: '🗂️' },
  { to: '/painel', label: 'Painel de cobertura', icon: '📊' },
  { to: '/agenda', label: 'Importar da Agenda', icon: '📅' },
]

const LABEL_ROLE: Record<string, string> = {
  consultor: 'Consultor',
  gestor: 'Gestor',
  administrador: 'Administrador',
}

export default function Layout() {
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false)
  const location = useLocation()

  const auth = pb.authStore.record
  const nome = String(auth?.name || auth?.email || '')
  const role = String(auth?.role || '')

  // LT-2-T02 — sincronização das agendas ao logar (pedido do champion 2026-10-07 12:53,
  // autorizado 12:55): no primeiro carregamento da sessão, importa as agendas das empresas
  // que o usuário pode ver. FIRE-AND-FORGET e silencioso — o sistema NUNCA depende do Google
  // (mesmo princípio da LT-2-T01); o botão manual da tela /agenda continua. Executado no
  // Layout (página já carregada) para o fetch não ser cancelado pelo redirect do login.
  const syncRodou = useRef(false)
  useEffect(() => {
    if (syncRodou.current) return
    syncRodou.current = true
    const rec = pb.authStore.record
    if (!rec?.id) return
    const r = String(rec.role || 'consultor')
    const autorizadas: string[] =
      r === 'gestor' || r === 'administrador'
        ? ['acuidar', 'donahelp']
        : ((rec.empresas_autorizadas as string[]) || []).filter(
            (e2) => e2 === 'acuidar' || e2 === 'donahelp',
          )
    for (const emp of autorizadas) {
      fetch(pb.baseUrl + '/backend/v1/agenda/importar', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: pb.authStore.token },
        body: JSON.stringify({ empresa: emp }),
      }).catch(() => {
        // silencioso — o sistema nunca depende do Google
      })
    }
  }, [])

  const sair = () => {
    pb.authStore.clear()
    window.location.href = '/login'
  }

  const navItems = NAV_ITENS.map((item) => {
    const ativo = location.pathname === item.to
    return (
      <Link
        key={item.to}
        to={item.to}
        onClick={() => setMobileMenuOpen(false)}
        className={`flex items-center gap-3 px-3 py-2.5 rounded-lg text-xs font-semibold transition-colors ${
          ativo
            ? 'bg-[#545955] text-[#bec6ba] shadow-sm'
            : 'text-[#bec6ba]/70 hover:bg-[#545955]/30 hover:text-[#bec6ba]'
        }`}
      >
        <span className="w-4 text-center flex-shrink-0">{item.icon}</span>
        <span className="truncate">{item.label}</span>
      </Link>
    )
  })

  return (
    <div className="min-h-screen bg-[#0c0c0c] text-[#bec6ba] flex flex-col md:flex-row">
      {/* Sidebar Desktop */}
      <aside className="hidden md:flex flex-col w-64 bg-[#141614] border-r border-[#343834] p-4 flex-shrink-0">
        <div className="flex items-center gap-3 px-2 py-3 mb-6 border-b border-[#343834]">
          <div className="h-10 w-10 rounded-lg bg-[var(--brand-primary)] flex items-center justify-center text-white font-black text-lg shrink-0">
            A
          </div>
          <div>
            <h1 className="font-black text-sm text-[#bec6ba] tracking-tight">ADAPTA CLIENTE</h1>
            <p className="text-[10px] uppercase font-bold text-[#bec6ba]/60">Intranet</p>
          </div>
        </div>

        <nav className="flex-1 space-y-1 overflow-y-auto pr-1">{navItems}</nav>

        <div className="pt-4 border-t border-[#343834] mt-auto">
          <div className="flex items-center justify-between p-2 rounded-lg bg-[#181a18]">
            <div className="flex items-center gap-2 overflow-hidden">
              <div className="h-8 w-8 rounded-full bg-[var(--brand-primary)] flex items-center justify-center text-white text-xs font-bold shrink-0">
                {(nome || 'U').slice(0, 1).toUpperCase()}
              </div>
              <div className="overflow-hidden text-xs">
                <p className="font-bold text-[#bec6ba] truncate">{nome || 'Usuário'}</p>
                <p className="text-[10px] text-[#bec6ba]/60 capitalize truncate">
                  {LABEL_ROLE[role] || role}
                </p>
              </div>
            </div>
            <button
              onClick={sair}
              title="Sair"
              className="text-[#bec6ba]/70 hover:text-red-400 h-8 w-8 flex items-center justify-center rounded hover:bg-transparent"
            >
              <LogOut className="w-4 h-4" />
            </button>
          </div>
        </div>
      </aside>

      {/* Header Mobile */}
      <div className="md:hidden flex items-center justify-between p-4 bg-[#141614] border-b border-[#343834]">
        <div className="flex items-center gap-2">
          <div className="h-8 w-8 rounded-lg bg-[var(--brand-primary)] flex items-center justify-center text-white font-black text-sm">
            A
          </div>
          <span className="font-bold text-sm text-[#bec6ba]">ADAPTA CLIENTE</span>
        </div>
        <button
          onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
          className="text-[#bec6ba] text-2xl px-2"
          aria-label="Menu"
        >
          {mobileMenuOpen ? '✕' : '☰'}
        </button>
      </div>

      {/* Navigation Mobile Overlay */}
      {mobileMenuOpen && (
        <div className="md:hidden bg-[#141614] border-b border-[#343834] p-4 space-y-1 z-50">
          {navItems}
          <div className="pt-2 border-t border-[#343834] mt-2">
            <button
              onClick={sair}
              className="w-full text-left px-3 py-2 rounded-lg text-xs font-bold text-red-400 hover:bg-red-950/30"
            >
              Sair do Sistema
            </button>
          </div>
        </div>
      )}

      {/* Main Content Area */}
      <main className="flex-1 flex flex-col min-w-0 overflow-y-auto bg-slate-50">
        <header className="hidden md:flex items-center justify-between px-6 py-3 bg-[#141614]/80 border-b border-[#343834]">
          <div className="text-xs font-medium text-[#bec6ba]/60">
            Intranet Adapta Cliente &bull; Painel de Controle
          </div>
          <div className="flex items-center gap-3">
            <span className="text-xs font-semibold text-[#bec6ba]">
              {nome} · {LABEL_ROLE[role] || role}
            </span>
          </div>
        </header>

        <div className="flex-1 p-4 md:p-6 overflow-y-auto">
          <Outlet />
        </div>
      </main>
    </div>
  )
}
