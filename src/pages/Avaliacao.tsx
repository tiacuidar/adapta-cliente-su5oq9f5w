import { useEffect, useMemo, useState } from 'react'
import pb from '@/lib/pocketbase/client'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Label } from '@/components/ui/label'
import { Input } from '@/components/ui/input'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { buscarUnidades } from '@/lib/unidades'

/* FAROL-1 (FA-2) — Formulário de avaliação PECAF/PEDHE com cálculo automático.
   Fórmula confirmada pelo champion: resultado geral = soma das 20 perguntas (0/1/2) +
   pontuação do faturamento (0-20) + pontuação dos contratos (0-20; PEDHE = 0).
   Perguntas fixas por programa (textos dos PDFs: PECAF = APP Acuidar/cuidadores;
   PEDHE = Web Help/Helpers). Unidade selecionada do cadastro oficial (nunca por nome —
   RN-1-19). Edição: gestor/admin (faturamento/contratos são dados de negócio — LGPD). */

const PERGUNTAS_PECAF = [
  '1. A unidade utiliza o módulo financeiro no APP Acuidar?',
  '2. Tem conhecimento dos números da sua operação e faz avaliação periódica?',
  '3. Controla o fluxo de caixa?',
  '4. Possui Capital de Giro?',
  '5. Atingiu o ponto de equilíbrio e Pay Back?',
  '6. Está realizando ações de Marketing?',
  '7. Faz uso de forma correta das redes sociais, gerando conteúdo que se relacione com seus consumidores, dentro dos padrões da franquia?',
  '8. Faz planejamentos de Posts?',
  '9. Realiza postagens de vídeos e stories próprios?',
  '10. Todos os clientes e cuidadores estão cadastrados no APP Acuidar?',
  '11. Gera no APP Acuidar os contratos dos Clientes e dos Cuidadores?',
  '12. Utiliza o CRM do App Acuidar para gerenciamento dos LEADS?',
  '13. Realiza Processo Seletivo com frequência?',
  '14. Tem relação próxima com a equipe, fazendo reuniões periódicas, procurando ouvir os colaboradores administrativos e cuidadores?',
  '15. Investe na capacitação da equipe e tem processos para avaliar a performance e conduta de seus colaboradores?',
  '16. Todos os cuidadores utilizam o UNIFORME/FARDAMENTO?',
  '17. Participa das ações de comunicação da franqueadora (lives, comunicados, comitês, Café com Franqueados) buscando estar sempre informado e atualizado?',
  '18. Mantém relação profissional e cordial com a Consultoria e demais equipes da franqueadora, entendendo os papéis das partes?',
  '19. Está presente na operação, pessoalmente ou através de responsável capacitado e é acessível para todos?',
  '20. Segue os padrões da franqueadora, atuando como zelador e representante da marca na sua região, colaborando para a construção de um negócio rentável e duradouro para todos?',
]

const PERGUNTAS_PEDHE = [
  '1. A unidade utiliza o módulo financeiro no Web Help?',
  '2. Tem conhecimento dos números da sua operação e faz avaliação periódica?',
  '3. Controla o fluxo de caixa?',
  '4. Possui Capital de Giro?',
  '5. Atingiu o ponto de equilíbrio e Pay Back?',
  '6. Está realizando ações de Marketing?',
  '7. Faz uso de forma correta das redes sociais, gerando conteúdo que se relacione com seus consumidores, dentro dos padrões da franquia?',
  '8. Realiza postagens de vídeos e stories próprios?',
  '9. Todos os clientes e helpers estão cadastrados no Web Helper?',
  '10. Gera no Web Helper os contratos dos Clientes e dos Helpers?',
  '11. Utiliza o CRM do Web Help para gerenciamento dos LEADS?',
  '12. Realiza Processo Seletivo com frequência?',
  '13. Todos os helpers utilizam o UNIFORME?',
  '14. Participa das ações de comunicação da franqueadora (lives, comunicados, comitês, Help Cast) buscando estar sempre informado e atualizado?',
  '15. Mantém relação profissional e cordial com a Consultoria e demais equipes da franqueadora, entendendo os papéis das partes?',
  '16. Está presente na operação, pessoalmente ou através de responsável capacitado e é acessível para todos?',
  '17. Confeciona material por conta própria sem o auxílio da franqueadora? Ex.: material gráfico, criação de artes, brindes.',
  '18. Segue os padrões da franqueadora, atuando como zelador e representante da marca na sua região, colaborando para a construção de um negócio rentável e duradouro para todos?',
]

// PEDHE tem 18 perguntas nos PDFs (1-12, 15-20 do PECAF adaptados) — mapeadas q1..q18;
// q19/q20 ficam 0 (a estrutura mantém 20 campos por compatibilidade com o PECAF).

const TEMPOS = [
  { v: '3m', label: 'Após 3 meses' },
  { v: '4m', label: 'Após 4 meses' },
  { v: '6m', label: 'Após 6 meses' },
  { v: '8m', label: 'Após 8 meses' },
  { v: '10m', label: 'Após 10 meses' },
  { v: '12m', label: 'Após 12 meses' },
  { v: '14m', label: 'Após 14 meses' },
  { v: '16m', label: 'Após 16 meses' },
  { v: '18m', label: 'Após 18 meses' },
  { v: '1a', label: 'Após 1 ano' },
  { v: '2a', label: 'Após 2 anos' },
  { v: '3a', label: 'Após 3 anos' },
  { v: '4a', label: 'Após 4 anos' },
  { v: '5a', label: 'Após 5 anos' },
  { v: '6a', label: 'Após 6 anos' },
]

type Unidade = {
  codigo: string
  nome: string
  razao_social: string
  empresa: 'acuidar' | 'donahelp'
}

const Avaliacao = () => {
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
  const programa = empresa === 'acuidar' ? 'pefcab' : 'pedhe'
  const perguntas = programa === 'pefcab' ? PERGUNTAS_PECAF : PERGUNTAS_PEDHE

  const [unidades, setUnidades] = useState<Unidade[]>([])
  const [unidadeErro, setUnidadeErro] = useState('')
  const [unidade, setUnidade] = useState('')
  const [ano, setAno] = useState(String(new Date().getFullYear()))
  const [referencia, setReferencia] = useState('')
  const [tempo, setTempo] = useState('')
  const [respostas, setRespostas] = useState<Record<string, number>>({})
  const [faturamento, setFaturamento] = useState('')
  const [pontFat, setPontFat] = useState('')
  const [contratos, setContratos] = useState('')
  const [pontCont, setPontCont] = useState('')
  const [ranqueada, setRanqueada] = useState('')
  const [observacao, setObservacao] = useState('')
  const [salvando, setSalvando] = useState(false)
  const [resultado, setResultado] = useState<null | {
    ok: boolean
    mensagem: string
    dados?: Record<string, unknown>
  }>(null)

  useEffect(() => {
    let vivo = true
    setUnidadeErro('')
    setUnidade('')
    buscarUnidades(empresa as 'acuidar' | 'donahelp').then((r) => {
      if (!vivo) return
      if (r.resultado === 'ok') setUnidades(r.unidades)
      else {
        setUnidades([])
        setUnidadeErro(r.motivo)
      }
    })
    return () => {
      vivo = false
    }
  }, [empresa])

  // Cálculo automático em tempo real (fórmula confirmada)
  const nPerguntas = perguntas.length
  const somaPerguntas = useMemo(() => {
    let s = 0
    for (let i = 1; i <= nPerguntas; i++) s += respostas['q' + i] || 0
    return s
  }, [respostas, nPerguntas])
  const pf = Number(pontFat || 0)
  const pc = programa === 'pefcab' ? Number(pontCont || 0) : 0
  const resultadoGeral = somaPerguntas + pf + pc

  const faltando = useMemo(() => {
    const f: string[] = []
    for (let i = 1; i <= nPerguntas; i++) {
      const v = respostas['q' + i]
      if (v === undefined) f.push('q' + i)
    }
    if (!unidade) f.push('Unidade')
    if (!ano) f.push('Ano')
    if (pontFat === '') f.push('Pontuação do faturamento')
    if (programa === 'pefcab' && pontCont === '') f.push('Pontuação dos contratos')
    if (!ranqueada) f.push('Ranqueada')
    return f
  }, [respostas, nPerguntas, unidade, ano, pontFat, pontCont, ranqueada, programa])

  const salvar = async () => {
    setResultado(null)
    if (faltando.length > 0) {
      setResultado({ ok: false, mensagem: 'Preencha: ' + faltando.join(', ') })
      return
    }
    setSalvando(true)
    try {
      const body: Record<string, unknown> = {
        programa,
        portal_unit_id: unidade,
        ano: Number(ano),
        referencia,
        tempo_franquia: tempo,
        pontuacao_faturamento: Number(pontFat),
        pontuacao_contratos: programa === 'pefcab' ? Number(pontCont) : 0,
        ranqueada,
        observacao,
      }
      for (let i = 1; i <= nPerguntas; i++) body['q' + i] = respostas['q' + i] || 0
      if (faturamento !== '') body.faturamento_bruto = Number(faturamento)
      if (programa === 'pefcab' && contratos !== '') body.contratos_fixos = Number(contratos)
      const res = await fetch(pb.baseUrl + '/backend/v1/avaliacoes/salvar', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: pb.authStore.token },
        body: JSON.stringify(body),
      })
      const data = (await res.json()) as Record<string, unknown>
      if (data.resultado === 'ok') {
        setResultado({
          ok: true,
          mensagem: `Avaliação ${data.atualizado ? 'atualizada' : 'gravada'} — resultado geral: ${data.resultado_geral} (perguntas ${data.soma_perguntas} + faturamento ${data.pontuacao_faturamento} + contratos ${data.pontuacao_contratos})`,
          dados: data,
        })
      } else {
        setResultado({ ok: false, mensagem: String(data.mensagem || 'Erro ao salvar.') })
      }
    } catch {
      setResultado({ ok: false, mensagem: 'Falha de comunicação ao salvar a avaliação.' })
    } finally {
      setSalvando(false)
    }
  }

  if (!podeEditar) {
    return (
      <div className="container mx-auto py-8 px-4 max-w-3xl">
        <h1 className="text-2xl font-bold mb-1">Avaliação PECAF/PEDHE</h1>
        <Alert className="mt-4">
          <AlertDescription>
            Somente gestor ou administrador preenche a avaliação (faturamento e contratos são dados
            de negócio). Consultores consultam pelo farol.
          </AlertDescription>
        </Alert>
      </div>
    )
  }

  return (
    <div className="container mx-auto py-8 px-4 max-w-4xl">
      <h1 className="text-2xl font-bold mb-1">
        Avaliação {programa === 'pefcab' ? 'PECAF' : 'PEDHE'}
      </h1>
      <p className="text-sm text-muted-foreground mb-4">
        {programa === 'pefcab'
          ? 'Programa de reconhecimento da rede Acuidar (anual — convenção).'
          : 'Programa de reconhecimento da rede Dona Help (anual — convenção).'}{' '}
        O sistema calcula o resultado geral automaticamente.
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
                <SelectItem value="acuidar">Acuidar (PECAF)</SelectItem>
              )}
              {autorizadas.includes('donahelp') && (
                <SelectItem value="donahelp">Dona Help (PEDHE)</SelectItem>
              )}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1">
          <Label className="text-xs">Unidade (código oficial)</Label>
          <Select value={unidade} onValueChange={setUnidade}>
            <SelectTrigger className="w-72">
              <SelectValue placeholder="Selecione a unidade" />
            </SelectTrigger>
            <SelectContent>
              {unidades.map((u) => (
                <SelectItem key={u.codigo} value={u.codigo}>
                  {u.codigo} — {u.nome}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          {unidadeErro && (
            <p className="text-xs text-destructive">
              Fonte de unidades indisponível ({unidadeErro}).
            </p>
          )}
        </div>
        <div className="space-y-1">
          <Label className="text-xs">Ano</Label>
          <Input
            value={ano}
            onChange={(e) => setAno(e.target.value)}
            className="w-24"
            inputMode="numeric"
          />
        </div>
        <div className="space-y-1">
          <Label className="text-xs">Referência</Label>
          <Input
            value={referencia}
            onChange={(e) => setReferencia(e.target.value)}
            placeholder="ex.: junho e julho"
            className="w-44"
          />
        </div>
        <div className="space-y-1">
          <Label className="text-xs">Tempo de franquia</Label>
          <Select value={tempo} onValueChange={setTempo}>
            <SelectTrigger className="w-40">
              <SelectValue placeholder="—" />
            </SelectTrigger>
            <SelectContent>
              {TEMPOS.map((t) => (
                <SelectItem key={t.v} value={t.v}>
                  {t.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      {resultado && (
        <Alert
          variant={resultado.ok ? 'default' : 'destructive'}
          className={`mb-4 ${resultado.ok ? 'border-green-600 bg-green-50' : ''}`}
        >
          <AlertDescription>{resultado.mensagem}</AlertDescription>
        </Alert>
      )}

      {/* Perguntas qualitativas */}
      <Card className="mb-4">
        <CardHeader>
          <CardTitle className="text-base">Perguntas qualitativas ({nPerguntas} — 0/1/2)</CardTitle>
          <CardDescription>
            0 = não atende · 1 = atende parcialmente · 2 = atende plenamente
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          {perguntas.map((texto, idx) => {
            const q = 'q' + (idx + 1)
            return (
              <div key={q} className="flex items-start gap-3">
                <span className="text-sm flex-1">{texto}</span>
                <Select
                  value={String(respostas[q] ?? '')}
                  onValueChange={(v) => setRespostas((r) => ({ ...r, [q]: Number(v) }))}
                >
                  <SelectTrigger className="w-24">
                    <SelectValue placeholder="—" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="0">0</SelectItem>
                    <SelectItem value="1">1</SelectItem>
                    <SelectItem value="2">2</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            )
          })}
        </CardContent>
      </Card>

      {/* Indicadores quantitativos */}
      <Card className="mb-4">
        <CardHeader>
          <CardTitle className="text-base">Indicadores quantitativos</CardTitle>
          <CardDescription>
            {programa === 'pefcab'
              ? 'Faturamento bruto e contratos mensais fixos (dados de negócio — visíveis só a gestor/admin).'
              : 'Faturamento bruto (o PEDHE não usa contratos — pontuação de contratos = 0).'}
          </CardDescription>
        </CardHeader>
        <CardContent className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <div className="space-y-1">
            <Label className="text-xs">Faturamento bruto (R$)</Label>
            <Input
              value={faturamento}
              onChange={(e) => setFaturamento(e.target.value)}
              inputMode="decimal"
              placeholder="ex.: 213719.98"
            />
          </div>
          <div className="space-y-1">
            <Label className="text-xs">Pontuação do faturamento (0-20)</Label>
            <Input
              value={pontFat}
              onChange={(e) => setPontFat(e.target.value)}
              inputMode="numeric"
              placeholder="0-20"
            />
          </div>
          {programa === 'pefcab' && (
            <>
              <div className="space-y-1">
                <Label className="text-xs">Contratos mensais fixos</Label>
                <Input
                  value={contratos}
                  onChange={(e) => setContratos(e.target.value)}
                  inputMode="numeric"
                  placeholder="ex.: 31"
                />
              </div>
              <div className="space-y-1">
                <Label className="text-xs">Pontuação dos contratos (0-20)</Label>
                <Input
                  value={pontCont}
                  onChange={(e) => setPontCont(e.target.value)}
                  inputMode="numeric"
                  placeholder="0-20"
                />
              </div>
            </>
          )}
          <div className="space-y-1">
            <Label className="text-xs">Ranqueada?</Label>
            <Select value={ranqueada} onValueChange={setRanqueada}>
              <SelectTrigger className="w-full">
                <SelectValue placeholder="—" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="sim">SIM</SelectItem>
                <SelectItem value="nao">NÃO</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </CardContent>
      </Card>

      {/* Resultado calculado em tempo real */}
      <Card className="mb-4 border-primary">
        <CardHeader>
          <CardTitle className="text-base">Resultado geral (calculado pelo sistema)</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-3xl font-bold">
            {resultadoGeral}
            <span className="text-sm font-normal text-muted-foreground ml-2">
              = perguntas {somaPerguntas} + faturamento {pf} + contratos {pc}
            </span>
          </p>
        </CardContent>
      </Card>

      <div className="space-y-1 mb-4">
        <Label className="text-xs">Observação (opcional)</Label>
        <Input
          value={observacao}
          onChange={(e) => setObservacao(e.target.value)}
          placeholder="contexto da avaliação"
        />
      </div>

      <Button onClick={salvar} disabled={salvando || faltando.length > 0}>
        {salvando
          ? 'Salvando…'
          : faltando.length > 0
            ? `Preencha ${faltando.length} campo(s)`
            : 'Salvar avaliação'}
      </Button>
      {faltando.length > 0 && (
        <p className="text-xs text-muted-foreground mt-2">Faltando: {faltando.join(', ')}</p>
      )}
    </div>
  )
}

export default Avaliacao
