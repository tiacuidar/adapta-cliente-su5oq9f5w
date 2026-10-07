import { useEffect, useMemo, useState } from 'react'
import pb from '@/lib/pocketbase/client'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Label } from '@/components/ui/label'
import { Input } from '@/components/ui/input'
import { PageHeader } from '@/components/PageHeader'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Alert, AlertDescription } from '@/components/ui/alert'

/* FA-8 — Tela Agenda (pedido do champion 2026-10-07 13:07, autorizado 13:08):
   reuniões AGENDADAS + FEITAS do dia, panorama para a consultora e visão completa
   para a administração (quem registrou cada reunião). A importação é AUTOMÁTICA no
   login (LT-2-T02) — a tela de importação saiu; o hook permanece. */

type Reuniao = {
  id: string
  horario: string
  titulo: string
  tipo: string
  estado: string
  unidade_codigo: string
  unidade_nome: string
  fonte: string
  criado_por_nome: string
  google_sync_estado: string
  relato: string
}

type Resposta =
  | {
      resultado: 'ok'
      empresa: string
      data: string
      hoje: string
      contagens: {
        total: number
        agendadas: number
        feitas: number
        confirmadas: number
        pendentes: number
        canceladas: number
      }
      agendadas: Reuniao[]
      feitas: Reuniao[]
    }
  | { resultado: 'erro'; mensagem?: string }

const BADGE_ESTADO: Record<string, 'default' | 'secondary' | 'destructive' | 'outline'> = {
  pendente: 'outline',
  em_revisao: 'secondary',
  aguardando_correcao: 'destructive',
  aguardando_aprovacao_de_excecao: 'destructive',
  possivel_duplicidade: 'destructive',
  falha_de_gravacao: 'destructive',
  confirmado: 'default',
}

const hojeISO = () => new Date().toISOString().slice(0, 10)

const Agenda = () => {
  const auth = pb.authStore.record
  const role = String(auth?.role || 'consultor')
  const autorizadas: string[] =
    role === 'gestor' || role === 'administrador'
      ? ['acuidar', 'donahelp']
      : ((auth?.empresas_autorizadas as string[]) || []).filter(
          (e) => e === 'acuidar' || e === 'donahelp',
        )

  const [empresa, setEmpresa] = useState(autorizadas[0] || 'acuidar')
  const [data, setData] = useState(hojeISO())
  const [dados, setDados] = useState<Resposta | null>(null)
  const [carregando, setCarregando] = useState(true)
  const [erro, setErro] = useState('')

  const carregar = (emp: string, dt: string) => {
    setCarregando(true)
    setErro('')
    fetch(`${pb.baseUrl}/backend/v1/agenda/dia?empresa=${emp}&data=${dt}`, {
      headers: { Authorization: pb.authStore.token },
    })
      .then((r) => r.json())
      .then((d: Resposta) => setDados(d))
      .catch(() => setErro('Falha de comunicação ao carregar a agenda.'))
      .finally(() => setCarregando(false))
  }

  useEffect(() => {
    carregar(empresa, data)
  }, [empresa, data])

  const ehHoje = useMemo(() => data === hojeISO(), [data])

  const CardReuniao = ({ r }: { r: Reuniao }) => (
    <div className="rounded-lg border p-3 shadow-subtle bg-white">
      <div className="flex items-center justify-between gap-2">
        <div className="min-w-0">
          <p className="font-bold text-sm text-[var(--brand-primary)] truncate">
            {r.horario} · {r.titulo}
          </p>
          <p className="text-xs text-muted-foreground">
            {r.unidade_nome}
            {r.unidade_codigo && r.unidade_codigo !== 'conferencia'
              ? ` (cód. ${r.unidade_codigo})`
              : ''}{' '}
            · {r.tipo || '—'} ·{' '}
            {r.fonte === 'google_calendar' ? 'Google Agenda' : 'entrada assistida'}
          </p>
        </div>
        <Badge variant={BADGE_ESTADO[r.estado] || 'outline'}>{r.estado}</Badge>
      </div>
      <p className="text-[10px] text-slate-400 mt-1">Registrada por: {r.criado_por_nome}</p>
    </div>
  )

  return (
    <div className="space-y-6">
      <PageHeader
        title="📅 Agenda"
        subtitle="Reuniões agendadas e feitas, dia a dia. A importação do Google Agenda é automática a cada login — esta tela mostra o que está na intranet."
      />

      <div className="flex flex-wrap gap-3 mb-2">
        <div className="space-y-1">
          <Label className="text-xs">Empresa</Label>
          <Select value={empresa} onValueChange={setEmpresa}>
            <SelectTrigger className="w-52">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {autorizadas.includes('acuidar') && (
                <SelectItem value="acuidar">Acuidar Franquias</SelectItem>
              )}
              {autorizadas.includes('donahelp') && (
                <SelectItem value="donahelp">Dona Help Franquias</SelectItem>
              )}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1">
          <Label className="text-xs">Data</Label>
          <Input
            type="date"
            value={data}
            onChange={(e) => setData(e.target.value)}
            className="w-44"
          />
        </div>
        {!ehHoje && (
          <div className="space-y-1 flex items-end">
            <button
              type="button"
              onClick={() => setData(hojeISO())}
              className="text-xs font-semibold text-[var(--brand-primary)] hover:underline"
            >
              voltar para hoje
            </button>
          </div>
        )}
      </div>

      {erro && (
        <Alert variant="destructive" className="mb-4">
          <AlertDescription>{erro}</AlertDescription>
        </Alert>
      )}

      {carregando && <p className="text-sm text-muted-foreground">Carregando…</p>}

      {!carregando && dados?.resultado === 'erro' && (
        <Alert variant="destructive" className="mb-4">
          <AlertDescription>{dados.mensagem || 'Erro ao carregar a agenda.'}</AlertDescription>
        </Alert>
      )}

      {!carregando && dados?.resultado === 'ok' && (
        <>
          {/* Panorama do dia */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-4">
            <Card className="shadow-subtle">
              <CardHeader className="pb-1">
                <CardDescription className="text-xs">Reuniões no dia</CardDescription>
              </CardHeader>
              <CardContent>
                <p className="text-2xl font-bold">{dados.contagens.total}</p>
              </CardContent>
            </Card>
            <Card className="shadow-subtle bg-sky-50/50 border-sky-200">
              <CardHeader className="pb-1">
                <CardDescription className="text-xs">Agendadas</CardDescription>
              </CardHeader>
              <CardContent>
                <p className="text-2xl font-bold text-sky-700">{dados.contagens.agendadas}</p>
              </CardContent>
            </Card>
            <Card className="shadow-subtle bg-emerald-50/50 border-emerald-200">
              <CardHeader className="pb-1">
                <CardDescription className="text-xs">Feitas</CardDescription>
              </CardHeader>
              <CardContent>
                <p className="text-2xl font-bold text-emerald-700">{dados.contagens.feitas}</p>
              </CardContent>
            </Card>
            <Card className="shadow-subtle">
              <CardHeader className="pb-1">
                <CardDescription className="text-xs">Confirmadas / pendentes</CardDescription>
              </CardHeader>
              <CardContent>
                <p className="text-2xl font-bold">
                  {dados.contagens.confirmadas}
                  <span className="text-base text-muted-foreground">
                    {' '}
                    / {dados.contagens.pendentes}
                  </span>
                </p>
              </CardContent>
            </Card>
          </div>

          {/* Agendadas */}
          <Card className="shadow-subtle">
            <CardHeader className="pb-2">
              <CardTitle className="text-base">🗓️ Agendadas — {data}</CardTitle>
              <CardDescription className="text-xs">
                Reuniões futuras (planejamento) — viram "feitas" quando a data passa.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-2">
              {dados.agendadas.length === 0 ? (
                <p className="text-sm text-muted-foreground py-2">
                  Nenhuma reunião agendada neste dia.
                </p>
              ) : (
                dados.agendadas.map((r) => <CardReuniao key={r.id} r={r} />)
              )}
            </CardContent>
          </Card>

          {/* Feitas */}
          <Card className="shadow-subtle">
            <CardHeader className="pb-2">
              <CardTitle className="text-base">✅ Feitas — {data}</CardTitle>
              <CardDescription className="text-xs">
                Reuniões com data passada (histórico — canceladas nunca são excluídas, RN-1-08).
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-2">
              {dados.feitas.length === 0 ? (
                <p className="text-sm text-muted-foreground py-2">
                  Nenhuma reunião feita neste dia.
                </p>
              ) : (
                dados.feitas.map((r) => <CardReuniao key={r.id} r={r} />)
              )}
            </CardContent>
          </Card>
        </>
      )}
    </div>
  )
}

export default Agenda
