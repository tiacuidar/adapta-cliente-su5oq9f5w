import { useEffect, useState } from 'react'
import pb from '@/lib/pocketbase/client'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Alert, AlertDescription } from '@/components/ui/alert'

/* FAROL-1 (FA-1) — Farol das Unidades: mapa de acompanhamento + status de atividade.
   Cadência mensal aprovada (30/31 dias conforme calendário):
   em_dia = registro no mês corrente ou programada · proximo_atraso = sem registro no mês
   corrente a partir do dia 20 · em_atraso = sem registro no mês corrente (ou mês anterior
   vazio) · programada = reunião futura na agenda · nao_retorna = 3+ tentativas sem resposta.
   RLS por empresa; somente leitura; dados_indisponiveis nunca conta como classificação. */

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

const STATUS_ATIVIDADE = [
  { v: 'ativa', label: 'Ativa', cor: 'bg-green-600' },
  { v: 'treinada', label: 'Treinada', cor: 'bg-blue-600' },
  { v: 'suspensa', label: 'Suspensa', cor: 'bg-amber-600' },
  { v: 'fechada', label: 'Fechada', cor: 'bg-gray-600' },
]

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
}

type Resposta =
  | {
      resultado: 'ok'
      empresa: string
      mes_referencia: string
      gerado_em: string
      total_unidades: number
      contagens: Record<string, number>
      status_atividade_contagem: Record<string, number>
      fonte_unidades: string
      fonte_status_atividade: string
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

const corClassificacao = (v: string) =>
  CLASSIFICACOES.find((c) => c.v === v)?.cor || 'bg-muted text-muted-foreground border-transparent'

const labelClassificacao = (v: string) => CLASSIFICACOES.find((c) => c.v === v)?.label || v

const Farol = () => {
  const auth = pb.authStore.record
  const role = String(auth?.role || 'consultor')
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

  useEffect(() => {
    let vivo = true
    setCarregando(true)
    setErro('')
    fetch(`${pb.baseUrl}/backend/v1/farol?empresa=${empresa}`, {
      headers: { Authorization: pb.authStore.token },
    })
      .then((r) => r.json())
      .then((d: Resposta) => {
        if (vivo) setDados(d)
      })
      .catch(() => {
        if (vivo) setErro('Falha de comunicação ao carregar o farol.')
      })
      .finally(() => {
        if (vivo) setCarregando(false)
      })
    return () => {
      vivo = false
    }
  }, [empresa])

  const ordenadas = (() => {
    if (!dados || dados.resultado !== 'ok') return []
    // Prioridade visual: não retorna → em atraso → próximo a atraso → sem classificação →
    // programada → em dia (o que exige atenção sobe)
    const peso: Record<string, number> = {
      nao_retorna: 0,
      em_atraso: 1,
      proximo_atraso: 2,
      sem_classificacao: 3,
      programada: 4,
      em_dia: 5,
    }
    return [...dados.linhas].sort(
      (a, b) => (peso[a.classificacao] ?? 9) - (peso[b.classificacao] ?? 9),
    )
  })()

  return (
    <div className="container mx-auto py-8 px-4 max-w-6xl">
      <h1 className="text-2xl font-bold mb-1">Farol das Unidades</h1>
      <p className="text-sm text-muted-foreground mb-4">
        Acompanhamento por unidade — cadência mensal (30/31 dias conforme o calendário). Visão
        somente leitura; o semáforo geral do PECAF/PEDHE entra na avaliação anual (FA-2/FA-3).
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
          {/* Mapa de acompanhamento — contagens por classificação */}
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

          {/* Status de atividade — gráfico de barras (distribuição) */}
          <Card className="mb-4">
            <CardHeader>
              <CardTitle className="text-base">Status de atividade das unidades</CardTitle>
              <CardDescription>
                Fonte: {dados.fonte_status_atividade}. Distribuição das {dados.total_unidades}{' '}
                unidades.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-2">
              {STATUS_ATIVIDADE.map((s) => {
                const n = dados.status_atividade_contagem[s.v] ?? 0
                const pct = dados.total_unidades ? Math.round((n / dados.total_unidades) * 100) : 0
                return (
                  <div key={s.v} className="flex items-center gap-3">
                    <span className="w-20 text-xs font-medium">{s.label}</span>
                    <div className="flex-1 h-4 rounded bg-muted overflow-hidden">
                      <div
                        className={`h-full ${s.cor}`}
                        style={{ width: `${pct}%` }}
                        role="img"
                        aria-label={`${s.label}: ${n} unidades (${pct}%)`}
                      />
                    </div>
                    <span className="w-24 text-xs text-muted-foreground text-right">
                      {n} ({pct}%)
                    </span>
                  </div>
                )
              })}
              {(dados.status_atividade_contagem.sem_status ?? 0) > 0 && (
                <p className="text-xs text-muted-foreground">
                  {dados.status_atividade_contagem.sem_status} unidade(s) sem status cadastrado — o
                  cadastro provisório é mantido por gestor/admin (a API do Portal entregará o campo
                  no futuro).
                </p>
              )}
            </CardContent>
          </Card>

          {/* Tabela do mapa */}
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Unidades — mapa de acompanhamento</CardTitle>
              <CardDescription>
                {dados.total_unidades} unidades · referência {dados.mes_referencia} · fontes:{' '}
                {dados.fonte_unidades}; {dados.fonte_status_atividade}
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b text-left text-xs text-muted-foreground">
                      <th className="py-2 pr-3">Unidade</th>
                      <th className="py-2 px-2">Situação</th>
                      <th className="py-2 px-2 text-center">No mês</th>
                      <th className="py-2 px-2 text-center">Mês anterior</th>
                      <th className="py-2 px-2 text-center">Programada</th>
                      <th className="py-2 px-2">Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {ordenadas.map((l) => (
                      <tr key={l.codigo} className="border-b last:border-0">
                        <td className="py-2 pr-3">
                          <span className="font-medium">{l.codigo}</span> — {l.nome}
                          {l.cidade && <span className="text-muted-foreground"> · {l.cidade}</span>}
                          {l.tentativas_sem_retorno > 0 && (
                            <span className="text-xs text-muted-foreground">
                              {' '}
                              · {l.tentativas_sem_retorno} tentativa(s) sem retorno
                            </span>
                          )}
                        </td>
                        <td className="py-2 px-2">
                          <span
                            className={`inline-block rounded border px-2 py-0.5 text-xs font-medium ${corClassificacao(l.classificacao)}`}
                          >
                            {labelClassificacao(l.classificacao)}
                          </span>
                        </td>
                        <td className="py-2 px-2 text-center">
                          {l.registro_no_mes > 0 ? l.registro_no_mes : '—'}
                        </td>
                        <td className="py-2 px-2 text-center">
                          {l.registro_mes_anterior > 0 ? l.registro_mes_anterior : '—'}
                        </td>
                        <td className="py-2 px-2 text-center text-xs">
                          {l.proxima_programada || '—'}
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
            </CardContent>
          </Card>
        </>
      )}
    </div>
  )
}

export default Farol
