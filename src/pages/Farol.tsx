import { useEffect, useMemo, useState } from 'react'
import { PieChart, Pie, Cell, ResponsiveContainer, Tooltip, Legend } from 'recharts'
import pb from '@/lib/pocketbase/client'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Label } from '@/components/ui/label'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { PageHeader } from '@/components/PageHeader'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'

/* FAROL-1 consolidado (FA-3+FA-4) — tela única por unidade (decisão champion 13:42):
   reúne mapa de acompanhamento (FA-1), SEMÁFORO PECAF/PEDHE (FA-3), status de atividade
   editável (gestor/admin), ocorrências da unidade com ações da fila conforme perfil,
   cobertura mensal e reuniões. Reutiliza hooks existentes (farol, painel, transicao)
   e a collection unidades_info (update direto — RLS gestor/admin na collection).
   "Registrar reunião" permanece aba própria (fora da consolidação). */

const SEMAFORO = [
  { v: 'verde', label: 'Verde (ranqueada)', dot: 'bg-green-500' },
  { v: 'amarelo', label: 'Amarelo (mínimos ok)', dot: 'bg-amber-400' },
  { v: 'vermelho', label: 'Vermelho (abaixo/sem dados)', dot: 'bg-red-500' },
  { v: 'sem_classificacao', label: 'Sem classificação (< 3 meses)', dot: 'bg-gray-300' },
]

type AvaliacaoInfo = {
  id: string
  resultado_geral: number
  ranqueada: string
  tempo_franquia: string
  referencia: string
  faturamento_bruto: number
  contratos_fixos: number | null
}

type Linha = {
  codigo: string
  nome: string
  cidade: string
  status_atividade: string
  observacao: string
  semaforo: string
  semaforo_motivo: string
  // FA-7 — mapa de acompanhamento mensal (regras aprovadas na FA-1)
  classificacao: string
  prioridade: number
  registro_no_mes: number
  proxima_programada: string
  tentativas_sem_retorno: number
  avaliacao: AvaliacaoInfo | null
}

type Resposta =
  | {
      resultado: 'ok'
      empresa: string
      programa: string
      ano_avaliacao: number
      gerado_em: string
      total_unidades: number
      semaforo_contagem: Record<string, number>
      status_atividade_contagem: Record<string, number>
      mapa_contagem: Record<string, number>
      mes_referencia: string
      fonte_mapa: string
      fonte_unidades: string
      fonte_status_atividade: string
      fonte_semaforo: string
      linhas: Linha[]
    }
  | {
      resultado: 'dados_indisponiveis'
      motivo: string
      fonte?: string
      empresa: string
      timestamp: string
    }
  | { resultado: 'erro'; mensagem?: string }

type Ocorrencia = {
  id: string
  empresa: string
  portal_unit_id: string
  occurrence_type: string
  data_fato: string
  horario: string
  titulo: string
  relato: string
  estado: string
  motivo: string
  updated: string
}

const dotSemaforo = (v: string) => SEMAFORO.find((s) => s.v === v)?.dot || 'bg-gray-300'

/* FA-7 — MAPA DE ACOMPANHAMENTO (regras aprovadas na FA-1) */
const MAPA = [
  { v: 'nao_retorna', label: 'Não retornam as tentativas', dot: 'bg-red-600', cor: '#dc2626' },
  { v: 'em_atraso', label: 'Em atraso com as reuniões', dot: 'bg-orange-500', cor: '#f97316' },
  { v: 'proximo_atraso', label: 'Próximo a ficar em atraso', dot: 'bg-amber-400', cor: '#fbbf24' },
  { v: 'programada', label: 'Com reunião programada', dot: 'bg-sky-500', cor: '#0ea5e9' },
  { v: 'em_dia', label: 'Em dia com as reuniões', dot: 'bg-emerald-500', cor: '#10b981' },
]

/* FA-7 — STATUS DE ATIVIDADE (unidades_info) */
const STATUS_ATIV = [
  { v: 'ativa', label: 'Ativa', cor: '#10b981' },
  { v: 'treinada', label: 'Treinada', cor: '#0ea5e9' },
  { v: 'suspensa', label: 'Suspensa', cor: '#fbbf24' },
  { v: 'fechada', label: 'Fechada', cor: '#94a3b8' },
  { v: 'sem_status', label: 'Sem status', cor: '#cbd5e1' },
]

const labelMapa = (v: string) => MAPA.find((m) => m.v === v)?.label || v
const dotMapa = (v: string) => MAPA.find((m) => m.v === v)?.dot || 'bg-gray-300'
const labelStatus = (v: string) => STATUS_ATIV.find((s) => s.v === v)?.label || v
const corStatus = (v: string) => STATUS_ATIV.find((s) => s.v === v)?.cor || '#cbd5e1'
const corMapa = (v: string) => MAPA.find((m) => m.v === v)?.cor || '#cbd5e1'

const BADGE_ESTADO: Record<string, 'default' | 'secondary' | 'destructive' | 'outline'> = {
  pendente: 'outline',
  em_revisao: 'secondary',
  aguardando_correcao: 'destructive',
  aguardando_aprovacao_de_excecao: 'destructive',
  possivel_duplicidade: 'destructive',
  falha_de_gravacao: 'destructive',
  confirmado: 'default',
}

const Farol = () => {
  const auth = pb.authStore.record
  const role = String(auth?.role || 'consultor')
  const podeEditar = role === 'gestor' || role === 'administrador'
  const autorizadas: string[] =
    role === 'gestor' || role === 'administrador'
      ? ['acuidar', 'donahelp']
      : ((auth?.empresas_autorizadas as string[]) || []).filter(
          (e) => e === 'acuidar' || e === 'donahelp',
        )
  const [empresa, setEmpresa] = useState(autorizadas[0] || 'acuidar')
  const [dados, setDados] = useState<Resposta | null>(null)
  const [carregando, setCarregando] = useState(true)
  const [erro, setErro] = useState('')
  const [filtroSemaforo, setFiltroSemaforo] = useState('todos')
  const [filtroMapa, setFiltroMapa] = useState('todos')
  const [busca, setBusca] = useState('')
  const [detalhe, setDetalhe] = useState<Linha | null>(null)

  const carregar = (emp: string) => {
    setCarregando(true)
    setErro('')
    fetch(`${pb.baseUrl}/backend/v1/farol?empresa=${emp}`, {
      headers: { Authorization: pb.authStore.token },
    })
      .then((r) => r.json())
      .then((d: Resposta) => setDados(d))
      .catch(() => setErro('Falha de comunicação ao carregar o farol.'))
      .finally(() => setCarregando(false))
  }

  useEffect(() => {
    carregar(empresa)
  }, [empresa])

  const filtradas = useMemo(() => {
    if (!dados || dados.resultado !== 'ok') return []
    return dados.linhas.filter(
      (l) =>
        (filtroSemaforo === 'todos' || l.semaforo === filtroSemaforo) &&
        (filtroMapa === 'todos' || l.classificacao === filtroMapa) &&
        (busca.trim() === '' ||
          l.nome.toLowerCase().includes(busca.toLowerCase()) ||
          l.codigo.includes(busca.trim())),
    )
  }, [dados, filtroSemaforo, filtroMapa, busca])

  // Dados dos gráficos (FA-7): distribuição do mapa + status de atividade
  const dadosMapa = useMemo(() => {
    if (!dados || dados.resultado !== 'ok') return []
    return MAPA.map((m) => ({
      nome: m.label,
      valor: dados.mapa_contagem[m.v] ?? 0,
      v: m.v,
      cor: m.cor,
    })).filter((x) => x.valor > 0)
  }, [dados])

  const dadosStatus = useMemo(() => {
    if (!dados || dados.resultado !== 'ok') return []
    return STATUS_ATIV.map((s) => ({
      nome: s.label,
      valor: dados.status_atividade_contagem[s.v] ?? 0,
      v: s.v,
      cor: s.cor,
    })).filter((x) => x.valor > 0)
  }, [dados])

  return (
    <div className="space-y-6">
      <PageHeader
        title="🚦 Farol das Unidades"
        subtitle="Semáforo PECAF/PEDHE (anual) + mapa de acompanhamento mensal com gráficos + status de atividade. Clique numa unidade para ver e editar o que compete ao seu perfil."
      />

      <div className="flex flex-wrap gap-3 mb-4">
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
          <Label className="text-xs">Semáforo</Label>
          <Select value={filtroSemaforo} onValueChange={setFiltroSemaforo}>
            <SelectTrigger className="w-64">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="todos">Todas as cores</SelectItem>
              {SEMAFORO.map((s) => (
                <SelectItem key={s.v} value={s.v}>
                  {s.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1">
          <Label className="text-xs">Situação (mês)</Label>
          <Select value={filtroMapa} onValueChange={setFiltroMapa}>
            <SelectTrigger className="w-64">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="todos">Todas as situações</SelectItem>
              {MAPA.map((m) => (
                <SelectItem key={m.v} value={m.v}>
                  {m.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1">
          <Label className="text-xs">Buscar</Label>
          <Input
            value={busca}
            onChange={(e) => setBusca(e.target.value)}
            placeholder="código ou nome"
            className="w-56"
          />
        </div>
      </div>

      {erro && (
        <Alert variant="destructive" className="mb-4">
          <AlertDescription>{erro}</AlertDescription>
        </Alert>
      )}

      {carregando && <p className="text-sm text-muted-foreground">Carregando…</p>}

      {!carregando && dados?.resultado === 'dados_indisponiveis' && (
        <Alert variant="destructive" className="mb-4">
          <AlertDescription>
            <strong>Dados indisponíveis</strong> ({dados.motivo}) — nenhuma classificação é exibida
            para não induzir a erro (RN-1-14).
          </AlertDescription>
        </Alert>
      )}

      {!carregando && dados?.resultado === 'erro' && (
        <Alert variant="destructive" className="mb-4">
          <AlertDescription>{dados.mensagem || 'Erro ao carregar o farol.'}</AlertDescription>
        </Alert>
      )}

      {!carregando && dados?.resultado === 'ok' && (
        <>
          {/* Semáforo — contagens clicáveis que filtram (estilo NEXUS FarolSummaryCards) */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-4">
            {SEMAFORO.map((s) => {
              const ativo = filtroSemaforo === s.v
              return (
                <Card
                  key={s.v}
                  onClick={() => setFiltroSemaforo(ativo ? 'todos' : s.v)}
                  className={`cursor-pointer transition-all hover:-translate-y-0.5 shadow-subtle ${
                    s.v === 'verde'
                      ? 'bg-emerald-50/50 border-emerald-200'
                      : s.v === 'amarelo'
                        ? 'bg-amber-50/50 border-amber-200'
                        : s.v === 'vermelho'
                          ? 'bg-rose-50/50 border-rose-200'
                          : 'bg-slate-50 border-slate-200'
                  } ${ativo ? 'ring-2 ring-[var(--brand-primary)] shadow-md scale-[1.02]' : ''}`}
                >
                  <CardHeader className="pb-1">
                    <CardDescription className="text-xs flex items-center gap-2">
                      <span className={`inline-block h-3 w-3 rounded-full ${s.dot}`} />
                      {s.label}
                    </CardDescription>
                  </CardHeader>
                  <CardContent>
                    <p className="text-2xl sm:text-3xl font-bold tracking-tight">
                      {dados.semaforo_contagem[s.v] ?? 0}
                    </p>
                  </CardContent>
                </Card>
              )
            })}
          </div>

          {/* FA-7 (decisão champion 2026-10-07 12:36): GRÁFICOS + MAPA DE ACOMPANHAMENTO +
              STATUS DE ATIVIDADE voltam ao farol, ALÉM do semáforo (os dois convivem). */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-3 mb-4">
            <Card className="shadow-subtle">
              <CardHeader className="pb-2">
                <CardTitle className="text-sm">
                  🗺️ Mapa de acompanhamento — {dados.mes_referencia}
                </CardTitle>
                <CardDescription className="text-xs">
                  Relação com as reuniões do mês (regras aprovadas na FA-1) · {dados.fonte_mapa}
                </CardDescription>
              </CardHeader>
              <CardContent>
                {dadosMapa.length === 0 ? (
                  <p className="text-sm text-muted-foreground py-6 text-center">
                    Sem dados no período.
                  </p>
                ) : (
                  <ResponsiveContainer width="100%" height={220}>
                    <PieChart>
                      <Pie
                        data={dadosMapa}
                        dataKey="valor"
                        nameKey="nome"
                        innerRadius={55}
                        outerRadius={85}
                        paddingAngle={2}
                      >
                        {dadosMapa.map((d) => (
                          <Cell key={d.v} fill={d.cor} />
                        ))}
                      </Pie>
                      <Tooltip />
                      <Legend
                        verticalAlign="bottom"
                        height={36}
                        formatter={(value: string) => {
                          const item = dadosMapa.find((d) => d.nome === value)
                          return `${value} (${item?.valor ?? 0})`
                        }}
                      />
                    </PieChart>
                  </ResponsiveContainer>
                )}
                {/* Cards clicáveis do mapa que filtram a tabela */}
                <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 mt-2">
                  {MAPA.map((m) => {
                    const ativo = filtroMapa === m.v
                    const n = dados.mapa_contagem[m.v] ?? 0
                    return (
                      <button
                        key={m.v}
                        type="button"
                        onClick={() => setFiltroMapa(ativo ? 'todos' : m.v)}
                        className={`text-left rounded-lg border p-2 transition-all hover:-translate-y-0.5 shadow-subtle ${
                          ativo ? 'ring-2 ring-[var(--brand-primary)] shadow-md scale-[1.02]' : ''
                        }`}
                      >
                        <span className="flex items-center gap-1.5 text-[10px] text-muted-foreground">
                          <span className={`inline-block h-2.5 w-2.5 rounded-full ${m.dot}`} />
                          {m.label}
                        </span>
                        <span className="text-lg font-bold tracking-tight">{n}</span>
                      </button>
                    )
                  })}
                </div>
              </CardContent>
            </Card>

            <Card className="shadow-subtle">
              <CardHeader className="pb-2">
                <CardTitle className="text-sm">📊 Status de atividade das unidades</CardTitle>
                <CardDescription className="text-xs">
                  {dados.fonte_status_atividade}
                </CardDescription>
              </CardHeader>
              <CardContent>
                {dadosStatus.length === 0 ? (
                  <p className="text-sm text-muted-foreground py-6 text-center">
                    Sem status cadastrado.
                  </p>
                ) : (
                  <ResponsiveContainer width="100%" height={220}>
                    <PieChart>
                      <Pie
                        data={dadosStatus}
                        dataKey="valor"
                        nameKey="nome"
                        innerRadius={55}
                        outerRadius={85}
                        paddingAngle={2}
                      >
                        {dadosStatus.map((d) => (
                          <Cell key={d.v} fill={d.cor} />
                        ))}
                      </Pie>
                      <Tooltip />
                      <Legend
                        verticalAlign="bottom"
                        height={36}
                        formatter={(value: string) => {
                          const item = dadosStatus.find((d) => d.nome === value)
                          return `${value} (${item?.valor ?? 0})`
                        }}
                      />
                    </PieChart>
                  </ResponsiveContainer>
                )}
                <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 mt-2">
                  {STATUS_ATIV.map((s) => {
                    const n = dados.status_atividade_contagem[s.v] ?? 0
                    return (
                      <div key={s.v} className="rounded-lg border p-2">
                        <span className="flex items-center gap-1.5 text-[10px] text-muted-foreground">
                          <span
                            className="inline-block h-2.5 w-2.5 rounded-full"
                            style={{ backgroundColor: s.cor }}
                          />
                          {s.label}
                        </span>
                        <span className="text-lg font-bold tracking-tight">{n}</span>
                      </div>
                    )
                  })}
                </div>
              </CardContent>
            </Card>
          </div>

          {/* Tabela de unidades — semáforo + situação mensal (FA-7) */}
          <Card className="shadow-subtle">
            <CardHeader>
              <CardTitle className="text-base">
                Unidades — semáforo {empresa === 'acuidar' ? 'PECAF' : 'PEDHE'} + situação do mês
              </CardTitle>
              <CardDescription>
                {dados.total_unidades} unidades · semáforo: {dados.fonte_semaforo} ·{' '}
                {dados.fonte_unidades}
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b text-left text-xs text-muted-foreground">
                      <th className="py-2 pr-3">Unidade</th>
                      <th className="py-2 px-2">Semáforo</th>
                      <th className="py-2 px-2">Situação (mês)</th>
                      <th className="py-2 px-2 text-center">Avaliação</th>
                      <th className="py-2 px-2">Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filtradas.map((l) => (
                      <tr
                        key={l.codigo}
                        className="border-b last:border-0 cursor-pointer hover:bg-muted/40"
                        onClick={() => setDetalhe(l)}
                      >
                        <td className="py-2 pr-3">
                          <span className="block text-xs font-bold text-[var(--brand-primary)]">
                            {l.nome}
                          </span>
                          <span className="text-[10px] text-slate-400">
                            código {l.codigo}
                            {l.cidade ? ` • ${l.cidade}` : ''}
                          </span>
                        </td>
                        <td className="py-2 px-2">
                          <span className="flex items-center gap-2">
                            <span
                              className={`inline-block h-3 w-3 rounded-full ${dotSemaforo(l.semaforo)}`}
                            />
                            <span className="text-xs font-bold text-slate-700">
                              {l.semaforo === 'sem_classificacao'
                                ? 'não se aplica'
                                : l.avaliacao
                                  ? `${l.avaliacao.resultado_geral} pts`
                                  : 'sem avaliação'}
                            </span>
                            {l.avaliacao && (
                              <span
                                className={`px-1.5 py-0.5 rounded font-bold text-[10px] ${
                                  l.avaliacao.ranqueada === 'sim'
                                    ? 'bg-emerald-100 text-emerald-700'
                                    : 'bg-slate-100 text-slate-500'
                                }`}
                              >
                                {l.avaliacao.ranqueada === 'sim' ? 'RANQUEADA' : 'NÃO RANQ.'}
                              </span>
                            )}
                          </span>
                        </td>
                        {/* FA-7 — situação mensal (mapa de acompanhamento) */}
                        <td className="py-2 px-2">
                          <span className="flex items-center gap-2">
                            <span
                              className={`inline-block h-2.5 w-2.5 rounded-full ${dotMapa(l.classificacao)}`}
                            />
                            <span className="text-xs text-slate-700">
                              {labelMapa(l.classificacao)}
                            </span>
                          </span>
                          <span className="text-[10px] text-slate-400">
                            {l.registro_no_mes > 0
                              ? `${l.registro_no_mes} no mês`
                              : l.proxima_programada
                                ? `programada ${l.proxima_programada}`
                                : l.tentativas_sem_retorno > 0
                                  ? `${l.tentativas_sem_retorno} tentativas sem retorno`
                                  : 'sem registro no mês'}
                          </span>
                        </td>
                        <td className="py-2 px-2 text-center text-xs">
                          {l.avaliacao ? l.avaliacao.tempo_franquia || '—' : '—'}
                        </td>
                        <td className="py-2 px-2">
                          {l.status_atividade ? (
                            <Badge variant="secondary">{l.status_atividade}</Badge>
                          ) : (
                            <span className="text-xs text-muted-foreground">—</span>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {filtradas.length === 0 && (
                <p className="text-sm text-muted-foreground py-4 text-center">
                  Nenhuma unidade neste filtro.
                </p>
              )}
            </CardContent>
          </Card>
        </>
      )}

      {/* Detalhe da unidade — FA-4 (tela única) */}
      {detalhe && (
        <DetalheUnidade
          linha={detalhe}
          empresa={empresa}
          programa={
            dados?.resultado === 'ok' ? dados.programa : empresa === 'acuidar' ? 'pecaf' : 'pedhe'
          }
          ano={dados?.resultado === 'ok' ? dados.ano_avaliacao : new Date().getFullYear()}
          podeEditar={podeEditar}
          role={role}
          onClose={() => setDetalhe(null)}
          onRefresh={() => carregar(empresa)}
        />
      )}
    </div>
  )
}

/* ===== Detalhe da unidade: avaliação + status + ocorrências + cobertura ===== */
const DetalheUnidade = ({
  linha,
  empresa,
  programa,
  ano,
  podeEditar,
  role,
  onClose,
  onRefresh,
}: {
  linha: Linha
  empresa: string
  programa: string
  ano: number
  podeEditar: boolean
  role: string
  onClose: () => void
  onRefresh: () => void
}) => {
  const [ocorrencias, setOcorrencias] = useState<Ocorrencia[]>([])
  const [carregandoOc, setCarregandoOc] = useState(true)
  const [selecionada, setSelecionada] = useState<Ocorrencia | null>(null)
  const [motivo, setMotivo] = useState('')
  const [erroOc, setErroOc] = useState('')
  const [msg, setMsg] = useState('')

  // Edição de status de atividade (unidades_info — RLS gestor/admin na collection)
  const [status, setStatus] = useState(linha.status_atividade || '')
  const [tentativas, setTentativas] = useState(String(linha.tentativas_sem_retorno || 0))
  const [observacao, setObservacao] = useState(linha.observacao || '')
  const [salvandoInfo, setSalvandoInfo] = useState(false)

  const carregarOcorrencias = () => {
    setCarregandoOc(true)
    pb.collection('ocorrencias')
      .getList(1, 20, {
        filter: `portal_unit_id = "${linha.codigo}" && empresa = "${empresa}"`,
        sort: '-data_fato,-created',
      })
      .then((res) => setOcorrencias(res.items as unknown as Ocorrencia[]))
      .catch(() => setOcorrencias([]))
      .finally(() => setCarregandoOc(false))
  }

  useEffect(() => {
    carregarOcorrencias()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [linha.codigo, empresa])

  const salvarInfo = async () => {
    setMsg('')
    setSalvandoInfo(true)
    try {
      const body: Record<string, unknown> = {
        empresa,
        portal_unit_id: linha.codigo,
        status_atividade: status || undefined,
        tentativas_sem_retorno: Number(tentativas || 0),
        observacao,
        atualizado_por: pb.authStore.record?.id || '',
      }
      // upsert: procura registro existente
      const existentes = await pb.collection('unidades_info').getList(1, 1, {
        filter: `empresa = "${empresa}" && portal_unit_id = "${linha.codigo}"`,
      })
      if (existentes.items.length > 0) {
        await pb.collection('unidades_info').update(existentes.items[0].id, body)
      } else {
        await pb.collection('unidades_info').create(body)
      }
      setMsg('Status de atividade atualizado.')
      onRefresh()
    } catch (e: unknown) {
      const m = e instanceof Error ? e.message : ''
      setMsg(
        m.includes('403') || m.includes('only admin') || m.includes('superusers')
          ? 'Somente gestor ou administrador edita o status de atividade.'
          : 'Falha ao salvar o status de atividade.',
      )
    } finally {
      setSalvandoInfo(false)
    }
  }

  const transicionar = async (oc: Ocorrencia, novoEstado: string, motivoTxt: string) => {
    setErroOc('')
    try {
      const res = await fetch(pb.baseUrl + '/backend/v1/ocorrencias/transicao', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: pb.authStore.token },
        body: JSON.stringify({ id: oc.id, estado: novoEstado, motivo: motivoTxt }),
      })
      const data = (await res.json()) as { resultado: string; mensagem?: string }
      if (data.resultado !== 'ok') {
        setErroOc(data.mensagem || 'Transição negada.')
        return
      }
      setSelecionada(null)
      setMotivo('')
      carregarOcorrencias()
      onRefresh()
    } catch {
      setErroOc('Falha de comunicação na transição.')
    }
  }

  const podeAprovar = role === 'gestor' || role === 'administrador'

  return (
    <Dialog open onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-w-3xl max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>
            {linha.codigo} — {linha.nome}
          </DialogTitle>
          <DialogDescription className="flex items-center gap-2">
            <span className={`inline-block h-3 w-3 rounded-full ${dotSemaforo(linha.semaforo)}`} />
            Semáforo: {linha.semaforo} — {linha.semaforo_motivo}
          </DialogDescription>
        </DialogHeader>

        {msg && (
          <Alert className="border-green-600 bg-green-50">
            <AlertDescription>{msg}</AlertDescription>
          </Alert>
        )}

        <Tabs defaultValue="avaliacao">
          <TabsList>
            <TabsTrigger value="avaliacao">Avaliação</TabsTrigger>
            <TabsTrigger value="status">Status</TabsTrigger>
            <TabsTrigger value="ocorrencias">Ocorrências</TabsTrigger>
          </TabsList>

          {/* Avaliação PECAF/PEDHE (leitura aqui; edição completa na aba Avaliação) */}
          <TabsContent value="avaliacao" className="space-y-3 text-sm">
            {linha.avaliacao ? (
              <div className="grid grid-cols-2 gap-2">
                <span>
                  Resultado geral: <strong>{linha.avaliacao.resultado_geral}</strong>
                </span>
                <span>
                  Ranqueada: <strong>{linha.avaliacao.ranqueada === 'sim' ? 'SIM' : 'NÃO'}</strong>
                </span>
                <span>Tempo de franquia: {linha.avaliacao.tempo_franquia || '—'}</span>
                <span>Referência: {linha.avaliacao.referencia || '—'}</span>
                <span>
                  Faturamento bruto:{' '}
                  {linha.avaliacao.faturamento_bruto
                    ? 'R$ ' + linha.avaliacao.faturamento_bruto.toLocaleString('pt-BR')
                    : '—'}
                </span>
                {programa === 'pecaf' && (
                  <span>Contratos fixos: {linha.avaliacao.contratos_fixos ?? '—'}</span>
                )}
              </div>
            ) : (
              <p className="text-muted-foreground">
                Sem avaliação {programa.toUpperCase()} {ano} — o semáforo está vermelho por falta de
                dados (ou não se aplica se a unidade tem menos de 3 meses).
              </p>
            )}
            {podeEditar && (
              <p className="text-xs text-muted-foreground">
                Para preencher/editar a avaliação completa (perguntas, faturamento, cliente oculto),
                use a aba <strong>Avaliação PECAF/PEDHE</strong> do menu.
              </p>
            )}
          </TabsContent>

          {/* Status de atividade — editável (gestor/admin) */}
          <TabsContent value="status" className="space-y-3">
            {podeEditar ? (
              <div className="grid grid-cols-3 gap-3">
                <div className="space-y-1">
                  <Label className="text-xs">Status de atividade</Label>
                  <Select value={status} onValueChange={setStatus}>
                    <SelectTrigger>
                      <SelectValue placeholder="—" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="ativa">Ativa</SelectItem>
                      <SelectItem value="treinada">Treinada</SelectItem>
                      <SelectItem value="suspensa">Suspensa</SelectItem>
                      <SelectItem value="fechada">Fechada</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1">
                  <Label className="text-xs">Tentativas sem retorno</Label>
                  <Input
                    value={tentativas}
                    onChange={(e) => setTentativas(e.target.value)}
                    inputMode="numeric"
                  />
                </div>
                <div className="space-y-1">
                  <Label className="text-xs">Observação</Label>
                  <Input value={observacao} onChange={(e) => setObservacao(e.target.value)} />
                </div>
                <div className="col-span-3">
                  <Button onClick={salvarInfo} disabled={salvandoInfo}>
                    {salvandoInfo ? 'Salvando…' : 'Salvar status'}
                  </Button>
                </div>
              </div>
            ) : (
              <p className="text-sm text-muted-foreground">
                Somente gestor ou administrador edita o status de atividade (dado de gestão).
              </p>
            )}
          </TabsContent>

          {/* Ocorrências da unidade + ações conforme perfil */}
          <TabsContent value="ocorrencias" className="space-y-3">
            {erroOc && (
              <Alert variant="destructive">
                <AlertDescription>{erroOc}</AlertDescription>
              </Alert>
            )}
            {carregandoOc ? (
              <p className="text-sm text-muted-foreground">Carregando…</p>
            ) : ocorrencias.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                Nenhuma ocorrência registrada para esta unidade.
              </p>
            ) : (
              <div className="space-y-2">
                {ocorrencias.map((oc) => (
                  <div
                    key={oc.id}
                    className="rounded-md border p-2 text-sm cursor-pointer hover:bg-muted/40"
                    onClick={() => {
                      setSelecionada(oc)
                      setMotivo('')
                      setErroOc('')
                    }}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="font-medium truncate">{oc.titulo}</span>
                      <Badge variant={BADGE_ESTADO[oc.estado] || 'outline'}>{oc.estado}</Badge>
                    </div>
                    <p className="text-xs text-muted-foreground">
                      {oc.occurrence_type} · {oc.data_fato?.slice(0, 10)} {oc.horario}
                    </p>
                  </div>
                ))}
              </div>
            )}
          </TabsContent>
        </Tabs>

        {/* Ação sobre a ocorrência selecionada (mesma máquina da fila) */}
        {selecionada && (
          <div className="rounded-md border p-3 space-y-2 text-sm">
            <p className="font-medium">{selecionada.titulo}</p>
            <p className="text-xs text-muted-foreground">
              Estado: {selecionada.estado} · {selecionada.data_fato?.slice(0, 10)}{' '}
              {selecionada.horario}
            </p>
            <div className="rounded bg-muted p-2 whitespace-pre-wrap text-xs">
              {selecionada.relato || '(sem relato)'}
            </div>
            {selecionada.motivo && (
              <div className="rounded bg-muted p-2 text-xs">
                <p className="font-medium mb-1">Trilha de decisão</p>
                <p className="whitespace-pre-wrap">{selecionada.motivo}</p>
              </div>
            )}
            {selecionada.estado === 'aguardando_aprovacao_de_excecao' && podeAprovar && (
              <>
                <Label className="text-xs">Decisão da exceção (motivo obrigatório)</Label>
                <Textarea
                  rows={2}
                  placeholder="Ex.: falha técnica comprovada na agenda — aprovado"
                  value={motivo}
                  onChange={(e) => setMotivo(e.target.value)}
                />
                <div className="flex gap-2">
                  <Button
                    size="sm"
                    disabled={!motivo.trim()}
                    onClick={() =>
                      transicionar(selecionada, 'confirmado', 'Exceção APROVADA: ' + motivo.trim())
                    }
                  >
                    Aprovar exceção
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={!motivo.trim()}
                    onClick={() =>
                      transicionar(
                        selecionada,
                        'aguardando_correcao',
                        'Exceção REJEITADA: ' + motivo.trim(),
                      )
                    }
                  >
                    Rejeitar
                  </Button>
                </div>
              </>
            )}
            {selecionada.estado === 'aguardando_correcao' && (
              <Button
                size="sm"
                onClick={() =>
                  transicionar(selecionada, 'em_revisao', 'Correção concluída pelo consultor.')
                }
              >
                Marcar correção concluída
              </Button>
            )}
            {!podeAprovar && selecionada.estado === 'aguardando_aprovacao_de_excecao' && (
              <p className="text-xs text-muted-foreground">
                Exceções aguardando aprovação exigem gestor/administrador (aprovador ≠ solicitante).
              </p>
            )}
          </div>
        )}
      </DialogContent>
    </Dialog>
  )
}

export default Farol
