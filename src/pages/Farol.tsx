import { useEffect, useMemo, useState } from 'react'
import pb from '@/lib/pocketbase/client'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Label } from '@/components/ui/label'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
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

const CLASSIFICACOES = [
  { v: 'em_dia', label: 'Em dia', cor: 'bg-green-100 text-green-800 border-green-300' },
  { v: 'programada', label: 'Programada', cor: 'bg-blue-100 text-blue-800 border-blue-300' },
  {
    v: 'proximo_atraso',
    label: 'Próximo a atraso',
    cor: 'bg-amber-100 text-amber-800 border-amber-300',
  },
  { v: 'em_atraso', label: 'Em atraso', cor: 'bg-red-100 text-red-800 border-red-300' },
  {
    v: 'nao_retorna',
    label: 'Não retorna tentativas',
    cor: 'bg-gray-200 text-gray-800 border-gray-400',
  },
]

const SEMAFORO = [
  { v: 'verde', label: 'Verde (ranqueada)', dot: 'bg-green-500' },
  { v: 'amarelo', label: 'Amarelo (mínimos ok)', dot: 'bg-amber-400' },
  { v: 'vermelho', label: 'Vermelho (abaixo/sem dados)', dot: 'bg-red-500' },
  { v: 'sem_classificacao', label: 'Sem classificação (< 3 meses)', dot: 'bg-gray-300' },
]

const STATUS_ATIVIDADE = ['ativa', 'treinada', 'suspensa', 'fechada']

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
  classificacao: string
  registro_no_mes: number
  registro_mes_anterior: number
  proxima_programada: string
  status_atividade: string
  tentativas_sem_retorno: number
  observacao: string
  semaforo: string
  semaforo_motivo: string
  avaliacao: AvaliacaoInfo | null
}

type Resposta =
  | {
      resultado: 'ok'
      empresa: string
      programa: string
      ano_avaliacao: number
      mes_referencia: string
      gerado_em: string
      total_unidades: number
      contagens: Record<string, number>
      semaforo_contagem: Record<string, number>
      status_atividade_contagem: Record<string, number>
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

const corClassificacao = (v: string) =>
  CLASSIFICACOES.find((c) => c.v === v)?.cor || 'bg-muted text-muted-foreground border-transparent'
const labelClassificacao = (v: string) => CLASSIFICACOES.find((c) => c.v === v)?.label || v
const dotSemaforo = (v: string) => SEMAFORO.find((s) => s.v === v)?.dot || 'bg-gray-300'

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
        (busca.trim() === '' ||
          l.nome.toLowerCase().includes(busca.toLowerCase()) ||
          l.codigo.includes(busca.trim())),
    )
  }, [dados, filtroSemaforo, busca])

  return (
    <div className="container mx-auto py-8 px-4 max-w-6xl">
      <h1 className="text-2xl font-bold mb-1">Farol das Unidades</h1>
      <p className="text-sm text-muted-foreground mb-4">
        Tela única por unidade: semáforo PECAF/PEDHE (anual), mapa de acompanhamento (mensal),
        status de atividade, ocorrências e cobertura. Clique numa unidade para ver e editar o que
        compete ao seu perfil.
      </p>

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
          {/* Semáforo — contagens (FA-3) */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-4">
            {SEMAFORO.map((s) => (
              <Card key={s.v}>
                <CardHeader className="pb-1">
                  <CardDescription className="text-xs flex items-center gap-2">
                    <span className={`inline-block h-3 w-3 rounded-full ${s.dot}`} />
                    {s.label}
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  <p className="text-2xl font-bold">{dados.semaforo_contagem[s.v] ?? 0}</p>
                </CardContent>
              </Card>
            ))}
          </div>

          {/* Mapa de acompanhamento — contagens (FA-1) */}
          <div className="grid grid-cols-2 md:grid-cols-5 gap-3 mb-4">
            {CLASSIFICACOES.map((c) => (
              <Card key={c.v}>
                <CardHeader className="pb-1">
                  <CardDescription className="text-xs">{c.label}</CardDescription>
                </CardHeader>
                <CardContent>
                  <p className="text-2xl font-bold">{dados.contagens[c.v] ?? 0}</p>
                </CardContent>
              </Card>
            ))}
          </div>

          {/* Tabela consolidada */}
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Unidades — visão consolidada</CardTitle>
              <CardDescription>
                {dados.total_unidades} unidades · semáforo: {dados.fonte_semaforo} · mapa:{' '}
                {dados.mes_referencia} · {dados.fonte_unidades}
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b text-left text-xs text-muted-foreground">
                      <th className="py-2 pr-3">Unidade</th>
                      <th className="py-2 px-2">Semáforo</th>
                      <th className="py-2 px-2">Situação</th>
                      <th className="py-2 px-2 text-center">Avaliação</th>
                      <th className="py-2 px-2">Status</th>
                      <th className="py-2 px-2 text-center">No mês</th>
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
                          <span className="font-medium">{l.codigo}</span> — {l.nome}
                          {l.cidade && <span className="text-muted-foreground"> · {l.cidade}</span>}
                        </td>
                        <td className="py-2 px-2">
                          <span className="flex items-center gap-2">
                            <span
                              className={`inline-block h-3 w-3 rounded-full ${dotSemaforo(l.semaforo)}`}
                            />
                            <span className="text-xs text-muted-foreground">
                              {l.semaforo === 'sem_classificacao'
                                ? 'não se aplica'
                                : l.avaliacao
                                  ? `${l.avaliacao.resultado_geral} pts · ${l.avaliacao.ranqueada === 'sim' ? 'ranqueada' : 'não ranqueada'}`
                                  : 'sem avaliação'}
                            </span>
                          </span>
                        </td>
                        <td className="py-2 px-2">
                          <span
                            className={`inline-block rounded border px-2 py-0.5 text-xs font-medium ${corClassificacao(l.classificacao)}`}
                          >
                            {labelClassificacao(l.classificacao)}
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
                        <td className="py-2 px-2 text-center">
                          {l.registro_no_mes > 0 ? l.registro_no_mes : '—'}
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
