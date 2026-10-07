import { useEffect, useState } from 'react'
import pb from '@/lib/pocketbase/client'
import { PageHeader } from '@/components/PageHeader'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Link } from 'react-router-dom'

/* LT-1-T01 — Home autenticada (estilo NEXUS FA-5): atalhos para as áreas.
   Rotas e regras NÃO mudam — apenas a apresentação. */

const ATALHOS = [
  {
    to: '/farol',
    titulo: 'Farol das unidades',
    desc: 'Semáforo PECAF/PEDHE + mapa + status + ocorrências',
  },
  {
    to: '/avaliacao',
    titulo: 'Avaliação PECAF/PEDHE',
    desc: 'Formulário com cálculo automático (gestor/admin)',
  },
  { to: '/reunioes/nova', titulo: 'Registrar reunião', desc: 'Registro assistido → ocorrência' },
  { to: '/fila', titulo: 'Fila de ocorrências', desc: 'Revisão e aprovação conforme perfil' },
  { to: '/painel', titulo: 'Painel de cobertura', desc: 'Cobertura operacional por unidade e mês' },
  {
    to: '/agenda',
    titulo: 'Importar da Agenda',
    desc: 'Google Calendar → ocorrências (idempotente)',
  },
]

const Index = () => {
  const [nome, setNome] = useState('')
  const [role, setRole] = useState('')

  useEffect(() => {
    const auth = pb.authStore.record
    setNome(String(auth?.name || auth?.email || ''))
    setRole(String(auth?.role || ''))
  }, [])

  return (
    <div className="space-y-6">
      <PageHeader
        title={`Bem-vindo, ${nome || 'usuário'}`}
        subtitle="Intranet Adapta Cliente — registro de reuniões, ocorrências e farol das unidades"
      />

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {ATALHOS.map((a) => (
          <Link key={a.to} to={a.to}>
            <Card className="cursor-pointer hover:-translate-y-0.5 transition-all shadow-subtle hover:shadow-md h-full">
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-bold text-[var(--brand-primary)]">
                  {a.titulo}
                </CardTitle>
                <CardDescription className="text-xs">{a.desc}</CardDescription>
              </CardHeader>
              <CardContent>{role && <Badge variant="secondary">{role}</Badge>}</CardContent>
            </Card>
          </Link>
        ))}
      </div>
    </div>
  )
}

export default Index
