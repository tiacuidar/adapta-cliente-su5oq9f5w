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
import { Button } from '@/components/ui/button'

/* LT-1-T04 — Painel de cobertura operacional (SPEC-1-003)
   Rótulos aprovados: "Cobertura operacional" e "Qualidade do registro" (RN-1-15).
   NUNCA exibir score, peso, faixa, ranking ou Health Score (CA-1-15 — linha vermelha).
   Somente leitura (CA-1-14); dados_indisponiveis nunca conta como cobertura (RN-1-14). */

const MESES = [
  'Janeiro',
  'Fevereiro',
  'Março',
  'Abril',
  'Maio',
  'Junho',
  'Julho',
  'Agosto',
  'Setembro',
  'Outubro',
  'Novembro',
  'Dezembro',
]

type Linha = {
  codigo: string
  nome: string
  cidade: string
  reuniao_pendente: number
  relato_pendente: number
  ocorrencia_pendente: number
  ocorrencia_incompleta: number
  ocorrencia_confirmada: number
  total: number
  ultima_atualizacao: string
}

type Resposta =
  | {
      resultado: 'ok'
      empresa: string
      mes: string
      gerado_em: string
      total_ocorrencias_no_mes: number
      total_unidades: number
      unidades_sem_registro_no_mes: number
      ocorrencias_fora_do_cadastro: number
      fonte_ocorrencias: string
      fonte_unidades: string
      unidades_timestamp: string
      linhas: Linha[]
    }
  | {
      resultado: 'dados_indisponiveis'
      motivo: string
      fonte: string
      empresa: string
      mes: string
      timestamp: string
    }
  | { resultado: 'erro'; mensagem?: string }

const Painel = () => {
  const [empresa, setEmpresa] = useState('acuidar')
  const [mes, setMes] = useState(() => new Date().toISOString().slice(0, 7))
  const [dados, setDados] = useState<Resposta | null>(null)
  const [carregando, setCarregando] = useState(true)
  const [erro, setErro] = useState('')

  useEffect(() => {
    let vivo = true
    setCarregando(true)
    setErro('')
    // Rota custom POST/GET fora de /api/*: fetch com URL absoluta do backend
    // (pb.send prefixa /api; nginx do preview não repassa /backend — AP-2026-10-02-1215)
    fetch(`${pb.baseUrl}/backend/v1/painel/cobertura?empresa=${empresa}&mes=${mes}`, {
      headers: { Authorization: pb.authStore.token },
    })
      .then((r) => r.json())
      .then((d: Resposta) => {
        if (vivo) setDados(d)
      })
      .catch(() => {
        if (vivo) setErro('Falha de comunicação ao carregar o painel.')
      })
      .finally(() => {
        if (vivo) setCarregando(false)
      })
    return () => {
      vivo = false
    }
  }, [empresa, mes])

  const mesLabel = (() => {
    const [a, m] = mes.split('-')
    return `${MESES[Number(m) - 1]} de ${a}`
  })()

  const ordenadas = (() => {
    if (!dados || dados.resultado !== 'ok') return []
    // Prioridade visual: unidades com pendências primeiro, depois confirmadas, depois sem registro
    const peso = (l: Linha) =>
      l.ocorrencia_pendente + l.ocorrencia_incompleta > 0 ? 0 : l.ocorrencia_confirmada > 0 ? 1 : 2
    return [...dados.linhas].sort((a, b) => peso(a) - peso(b) || a.codigo.localeCompare(b.codigo))
  })()

  const totais = (() => {
    const t = {
      reuniao_pendente: 0,
      relato_pendente: 0,
      ocorrencia_pendente: 0,
      ocorrencia_incompleta: 0,
      ocorrencia_confirmada: 0,
    }
    if (!dados || dados.resultado !== 'ok') return t
    for (const l of dados.linhas) {
      t.reuniao_pendente += l.reuniao_pendente
      t.relato_pendente += l.relato_pendente
      t.ocorrencia_pendente += l.ocorrencia_pendente
      t.ocorrencia_incompleta += l.ocorrencia_incompleta
      t.ocorrencia_confirmada += l.ocorrencia_confirmada
    }
    return t
  })()

  return (
    <div className="container mx-auto py-8 px-4 max-w-6xl">
      <h1 className="text-2xl font-bold mb-1">Cobertura operacional</h1>
      <p className="text-sm text-muted-foreground mb-4">
        Qualidade do registro por unidade e período — visão somente leitura. Não exibe Health Score.
      </p>

      <div className="flex flex-wrap gap-3 mb-4">
        <div className="space-y-1">
          <Label className="text-xs">Empresa</Label>
          <Select value={empresa} onValueChange={setEmpresa}>
            <SelectTrigger className="w-52">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="acuidar">Acuidar Franquias</SelectItem>
              <SelectItem value="donahelp">Dona Help Franquias</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1">
          <Label className="text-xs">Mês de análise</Label>
          <Select value={mes} onValueChange={setMes}>
            <SelectTrigger className="w-44">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {[0, 1, 2, 3].map((i) => {
                const d = new Date()
                d.setMonth(d.getMonth() - i)
                const v = d.toISOString().slice(0, 7)
                const [a, m] = v.split('-')
                return (
                  <SelectItem key={v} value={v}>
                    {MESES[Number(m) - 1]} de {a}
                  </SelectItem>
                )
              })}
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
            <strong>Dados indisponíveis</strong> — não foi possível obter {dados.fonte} agora (
            {new Date(dados.timestamp).toLocaleString('pt-BR')}). Nenhuma contagem de cobertura é
            exibida para não induzir a erro (RN-1-14).
          </AlertDescription>
        </Alert>
      )}

      {!carregando && dados?.resultado === 'erro' && (
        <Alert variant="destructive" className="mb-4">
          <AlertDescription>{dados.mensagem || 'Erro ao carregar o painel.'}</AlertDescription>
        </Alert>
      )}

      {!carregando && dados?.resultado === 'ok' && (
        <>
          <div className="grid grid-cols-2 md:grid-cols-5 gap-3 mb-4">
            <Card>
              <CardHeader className="pb-1">
                <CardDescription className="text-xs">Reunião pendente</CardDescription>
              </CardHeader>
              <CardContent>
                <p className="text-2xl font-bold">{totais.reuniao_pendente}</p>
              </CardContent>
            </Card>
            <Card>
              <CardHeader className="pb-1">
                <CardDescription className="text-xs">Relato pendente</CardDescription>
              </CardHeader>
              <CardContent>
                <p className="text-2xl font-bold">{totais.relato_pendente}</p>
              </CardContent>
            </Card>
            <Card>
              <CardHeader className="pb-1">
                <CardDescription className="text-xs">Ocorrência pendente</CardDescription>
              </CardHeader>
              <CardContent>
                <p className="text-2xl font-bold text-amber-600">{totais.ocorrencia_pendente}</p>
              </CardContent>
            </Card>
            <Card>
              <CardHeader className="pb-1">
                <CardDescription className="text-xs">Ocorrência incompleta</CardDescription>
              </CardHeader>
              <CardContent>
                <p className="text-2xl font-bold text-amber-600">{totais.ocorrencia_incompleta}</p>
              </CardContent>
            </Card>
            <Card>
              <CardHeader className="pb-1">
                <CardDescription className="text-xs">Ocorrência confirmada</CardDescription>
              </CardHeader>
              <CardContent>
                <p className="text-2xl font-bold text-green-600">{totais.ocorrencia_confirmada}</p>
              </CardContent>
            </Card>
          </div>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">Unidades — {mesLabel}</CardTitle>
              <CardDescription>
                {dados.total_unidades} unidades · {dados.total_ocorrencias_no_mes} ocorrências no
                mês · {dados.unidades_sem_registro_no_mes} sem registro no período · fontes:{' '}
                {dados.fonte_ocorrencias}; {dados.fonte_unidades} (atualizado{' '}
                {new Date(dados.unidades_timestamp).toLocaleString('pt-BR')})
              </CardDescription>
            </CardHeader>
            <CardContent>
              {dados.ocorrencias_fora_do_cadastro > 0 && (
                <Alert className="mb-3">
                  <AlertDescription>
                    {dados.ocorrencias_fora_do_cadastro} ocorrência(s) com unidade fora do cadastro
                    atual — conferir na fila (não inferimos a unidade por suposição — RN-1-19).
                  </AlertDescription>
                </Alert>
              )}
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b text-left text-xs text-muted-foreground">
                      <th className="py-2 pr-3">Unidade</th>
                      <th className="py-2 px-2 text-center">Reunião pendente</th>
                      <th className="py-2 px-2 text-center">Relato pendente</th>
                      <th className="py-2 px-2 text-center">Ocorrência pendente</th>
                      <th className="py-2 px-2 text-center">Incompleta</th>
                      <th className="py-2 px-2 text-center">Confirmada</th>
                      <th className="py-2 px-2 text-center">Evidência</th>
                    </tr>
                  </thead>
                  <tbody>
                    {ordenadas.map((l) => (
                      <tr key={l.codigo} className="border-b last:border-0">
                        <td className="py-2 pr-3">
                          <span className="font-medium">{l.codigo}</span> — {l.nome}
                          {l.cidade && <span className="text-muted-foreground"> · {l.cidade}</span>}
                        </td>
                        <td className="py-2 px-2 text-center">
                          {l.reuniao_pendente ? (
                            <Badge variant="outline">{l.reuniao_pendente}</Badge>
                          ) : (
                            '—'
                          )}
                        </td>
                        <td className="py-2 px-2 text-center">
                          {l.relato_pendente ? (
                            <Badge variant="outline">{l.relato_pendente}</Badge>
                          ) : (
                            '—'
                          )}
                        </td>
                        <td className="py-2 px-2 text-center">
                          {l.ocorrencia_pendente ? (
                            <Badge variant="destructive">{l.ocorrencia_pendente}</Badge>
                          ) : (
                            '—'
                          )}
                        </td>
                        <td className="py-2 px-2 text-center">
                          {l.ocorrencia_incompleta ? (
                            <Badge variant="destructive">{l.ocorrencia_incompleta}</Badge>
                          ) : (
                            '—'
                          )}
                        </td>
                        <td className="py-2 px-2 text-center">
                          {l.ocorrencia_confirmada ? (
                            <Badge variant="default">{l.ocorrencia_confirmada}</Badge>
                          ) : (
                            '—'
                          )}
                        </td>
                        <td className="py-2 px-2 text-center">
                          {l.total > 0 && (
                            <Button variant="link" size="sm" className="h-auto p-0" asChild>
                              <a href="/fila">ver na fila</a>
                            </Button>
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

export default Painel
