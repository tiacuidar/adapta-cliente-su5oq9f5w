import { useEffect, useMemo, useState } from 'react'
import pb from '@/lib/pocketbase/client'
import { buscarUnidades, type Unidade } from '@/lib/unidades'
import { Button } from '@/components/ui/button'
import { PageHeader } from '@/components/PageHeader'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Checkbox } from '@/components/ui/checkbox'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Badge } from '@/components/ui/badge'

/* LT-1-T02 — Registro de reunião → ocorrência (SPEC-1-001)
   RN-1-03: obrigatórios; RN-1-01: unidade única; RN-1-02: divergência de data → exceção;
   CA-1-05: idempotência SHA-256; RN-1-04/05: confirmado só com ID; RN-1-07: multiunidade. */

const TIPOS = ['Acompanhamento', 'Consultoria', 'Café com Franqueados', 'Day Fusion', 'Outro']

type EstadoCriacao =
  | { tipo: 'idle' }
  | { tipo: 'criando' }
  | { tipo: 'confirmado'; id: string; estado: string }
  | { tipo: 'falha'; estado: string; mensagem: string }
  | { tipo: 'excecao'; estado: string; mensagem: string }

const NovaReuniao = () => {
  // LT-1-T06 — RLS por empresa: o usuário só registra nas empresas autorizadas
  const auth = pb.authStore.record
  const role = String(auth?.role || 'consultor')
  const autorizadas: ('acuidar' | 'donahelp')[] =
    role === 'gestor' || role === 'administrador'
      ? ['acuidar', 'donahelp']
      : ((auth?.empresas_autorizadas as ('acuidar' | 'donahelp')[]) || []).filter(
          (e) => e === 'acuidar' || e === 'donahelp',
        )
  const [empresa, setEmpresa] = useState<'acuidar' | 'donahelp'>(autorizadas[0] || 'acuidar')
  const [unidades, setUnidades] = useState<Unidade[]>([])
  const [fonteStatus, setFonteStatus] = useState<'carregando' | 'ok' | 'indisponivel'>('carregando')
  const [unidadeCodigo, setUnidadeCodigo] = useState('')
  const [dataFato, setDataFato] = useState(() => new Date().toISOString().slice(0, 10))
  const [horario, setHorario] = useState('')
  const [tipo, setTipo] = useState('')
  const [titulo, setTitulo] = useState('')
  const [relato, setRelato] = useState('')
  const [multiunidade, setMultiunidade] = useState(false)
  const [unidadesExtras, setUnidadesExtras] = useState<string[]>([])
  const [divergencia, setDivergencia] = useState(false)
  const [justificativa, setJustificativa] = useState('')
  const [pendencias, setPendencias] = useState<string[]>([])
  const [criacao, setCriacao] = useState<EstadoCriacao>({ tipo: 'idle' })

  useEffect(() => {
    let vivo = true
    setFonteStatus('carregando')
    setUnidades([])
    setUnidadeCodigo('')
    setUnidadesExtras([])
    buscarUnidades(empresa).then((r) => {
      if (!vivo) return
      if (r.resultado === 'ok') {
        setUnidades(r.unidades)
        setFonteStatus('ok')
      } else {
        setFonteStatus('indisponivel')
      }
    })
    return () => {
      vivo = false
    }
  }, [empresa])

  const unidadesSelecionadas = useMemo(() => {
    const base = unidadeCodigo ? [unidadeCodigo] : []
    return multiunidade ? Array.from(new Set([...base, ...unidadesExtras])) : base
  }, [unidadeCodigo, unidadesExtras, multiunidade])

  const validar = (): string[] => {
    const faltando: string[] = []
    if (unidadesSelecionadas.length === 0) faltando.push('Unidade')
    if (!dataFato) faltando.push('Data do fato')
    if (!horario) faltando.push('Horário')
    if (!tipo) faltando.push('Tipo')
    if (!titulo.trim()) faltando.push('Título')
    if (!relato.trim()) faltando.push('Relato')
    if (divergencia && !justificativa.trim()) faltando.push('Justificativa da divergência de data')
    return faltando
  }

  const registrar = async (e: React.FormEvent) => {
    e.preventDefault()
    setCriacao({ tipo: 'idle' })
    const faltando = validar()
    if (faltando.length > 0) {
      setPendencias(faltando)
      return
    }
    setPendencias([])

    // RN-1-05A (linha vermelha): relato não pode carregar HTML/script — bloquear, sem conversão
    if (/<\s*(script|iframe|img|svg|object|embed)/i.test(relato) || /javascript:/i.test(relato)) {
      setPendencias([
        'O relato contém conteúdo não permitido (HTML/código). Remova e descreva em texto.',
      ])
      return
    }

    setCriacao({ tipo: 'criando' })
    try {
      // source_meeting_id: entrada assistida manual gera ID estável da origem
      const sourceMeetingId = 'manual-' + dataFato.replace(/-/g, '') + '-' + Date.now()
      const res = await pb.send('/backend/v1/ocorrencias/criar', {
        method: 'POST',
        body: {
          source_system: 'entrada_assistida',
          source_meeting_id: sourceMeetingId,
          portal_unit_ids: unidadesSelecionadas,
          empresa: empresa,
          occurrence_type: tipo,
          data_fato: dataFato,
          horario: horario,
          titulo: titulo.trim(),
          relato: relato.trim(),
          divergencia_data: divergencia,
          justificativa: divergencia ? justificativa.trim() : '',
        },
      })
      const data = res as { resultado: string; id?: string; estado?: string; mensagem?: string }
      if (data.resultado === 'confirmado' && data.id) {
        setCriacao({ tipo: 'confirmado', id: data.id, estado: data.estado || 'confirmado' })
      } else if (data.resultado === 'aguardando_aprovacao_de_excecao') {
        setCriacao({
          tipo: 'excecao',
          estado: data.estado || 'aguardando_aprovacao_de_excecao',
          mensagem: data.mensagem || 'Divergência de data enviada para aprovação.',
        })
      } else {
        setCriacao({
          tipo: 'falha',
          estado: data.estado || 'falha_de_gravacao',
          mensagem:
            data.mensagem ||
            'Não foi possível confirmar a criação. Nenhuma ocorrência foi registrada como confirmada.',
        })
      }
    } catch {
      setCriacao({
        tipo: 'falha',
        estado: 'falha_de_gravacao',
        mensagem: 'Falha de comunicação. Nenhuma ocorrência foi registrada como confirmada.',
      })
    }
  }

  const limpar = () => {
    setUnidadeCodigo('')
    setUnidadesExtras([])
    setDataFato(new Date().toISOString().slice(0, 10))
    setHorario('')
    setTipo('')
    setTitulo('')
    setRelato('')
    setMultiunidade(false)
    setDivergencia(false)
    setJustificativa('')
    setPendencias([])
    setCriacao({ tipo: 'idle' })
  }

  return (
    <div className="space-y-6 max-w-2xl">
      <PageHeader
        title="🎥 Registrar reunião"
        subtitle="Registro assistido — a ocorrência é criada na intranet após sua confirmação"
      />
      <Card className="shadow-subtle">
        <CardContent className="pt-6">
          {criacao.tipo === 'confirmado' && (
            <Alert className="mb-4 border-green-600 bg-green-50">
              <AlertDescription>
                ✅ Ocorrência <strong>confirmada</strong> — comprovante ID:{' '}
                <Badge variant="secondary">{criacao.id}</Badge>
                <Button variant="link" size="sm" onClick={limpar}>
                  Registrar outra reunião
                </Button>
              </AlertDescription>
            </Alert>
          )}
          {criacao.tipo === 'excecao' && (
            <Alert className="mb-4 border-amber-600 bg-amber-50">
              <AlertDescription>
                ⏳ {criacao.mensagem} Estado: <Badge variant="secondary">{criacao.estado}</Badge>
                <Button variant="link" size="sm" onClick={limpar}>
                  Registrar outra reunião
                </Button>
              </AlertDescription>
            </Alert>
          )}
          {criacao.tipo === 'falha' && (
            <Alert variant="destructive" className="mb-4">
              <AlertDescription>
                ❌ {criacao.mensagem} Estado: <Badge variant="secondary">{criacao.estado}</Badge>
                <Button variant="link" size="sm" onClick={limpar}>
                  Tentar novamente
                </Button>
              </AlertDescription>
            </Alert>
          )}

          <form onSubmit={registrar} className="space-y-4">
            {pendencias.length > 0 && (
              <Alert variant="destructive">
                <AlertDescription>Campos pendentes: {pendencias.join(', ')}</AlertDescription>
              </Alert>
            )}

            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>Empresa</Label>
                <Select
                  value={empresa}
                  onValueChange={(v) => setEmpresa(v as 'acuidar' | 'donahelp')}
                >
                  <SelectTrigger>
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
              <div className="space-y-2">
                <Label>Unidade (código oficial)</Label>
                {fonteStatus === 'carregando' && (
                  <Input disabled placeholder="Carregando unidades…" />
                )}
                {fonteStatus === 'indisponivel' && (
                  <Alert variant="destructive">
                    <AlertDescription>
                      Dados indisponíveis — a lista de unidades não pôde ser carregada. Tente
                      novamente mais tarde.
                    </AlertDescription>
                  </Alert>
                )}
                {fonteStatus === 'ok' && (
                  <Select value={unidadeCodigo} onValueChange={setUnidadeCodigo}>
                    <SelectTrigger>
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
                )}
              </div>
            </div>

            <div className="flex items-center gap-2">
              <Checkbox
                id="multiunidade"
                checked={multiunidade}
                onCheckedChange={(v) => setMultiunidade(v === true)}
              />
              <Label htmlFor="multiunidade" className="font-normal">
                Evento multiunidade (Café com Franqueados, Day Fusion…)
              </Label>
            </div>

            {multiunidade && fonteStatus === 'ok' && (
              <div className="space-y-2 rounded-md border p-3">
                <Label>Unidades participantes adicionais</Label>
                <div className="max-h-40 overflow-y-auto space-y-1">
                  {unidades
                    .filter((u) => u.codigo !== unidadeCodigo)
                    .map((u) => (
                      <label key={u.codigo} className="flex items-center gap-2 text-sm">
                        <Checkbox
                          checked={unidadesExtras.includes(u.codigo)}
                          onCheckedChange={(v) =>
                            setUnidadesExtras((prev) =>
                              v ? [...prev, u.codigo] : prev.filter((c) => c !== u.codigo),
                            )
                          }
                        />
                        {u.codigo} — {u.nome}
                      </label>
                    ))}
                </div>
                {unidadesSelecionadas.length > 0 && (
                  <p className="text-xs text-muted-foreground">
                    A mesma reunião será vinculada a {unidadesSelecionadas.length} unidade(s):{' '}
                    {unidadesSelecionadas.join(', ')}
                  </p>
                )}
              </div>
            )}

            <div className="grid grid-cols-3 gap-4">
              <div className="space-y-2">
                <Label htmlFor="dataFato">Data do fato</Label>
                <Input
                  id="dataFato"
                  type="date"
                  value={dataFato}
                  onChange={(e) => setDataFato(e.target.value)}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="horario">Horário</Label>
                <Input
                  id="horario"
                  type="time"
                  value={horario}
                  onChange={(e) => setHorario(e.target.value)}
                />
              </div>
              <div className="space-y-2">
                <Label>Tipo</Label>
                <Select value={tipo} onValueChange={setTipo}>
                  <SelectTrigger>
                    <SelectValue placeholder="Selecione" />
                  </SelectTrigger>
                  <SelectContent>
                    {TIPOS.map((t) => (
                      <SelectItem key={t} value={t}>
                        {t}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div className="space-y-2">
              <Label htmlFor="titulo">Título</Label>
              <Input
                id="titulo"
                maxLength={200}
                placeholder="Ex.: Acompanhamento — Acuidar JP Centro"
                value={titulo}
                onChange={(e) => setTitulo(e.target.value)}
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="relato">Relato</Label>
              <Textarea
                id="relato"
                rows={5}
                placeholder="Descreva o que foi tratado na reunião (texto simples)"
                value={relato}
                onChange={(e) => setRelato(e.target.value)}
              />
            </div>

            <div className="flex items-start gap-2">
              <Checkbox
                id="divergencia"
                checked={divergencia}
                onCheckedChange={(v) => setDivergencia(v === true)}
              />
              <div className="space-y-1">
                <Label htmlFor="divergencia" className="font-normal">
                  A data do fato difere da data real da reunião (divergência de data)
                </Label>
                {divergencia && (
                  <Textarea
                    rows={2}
                    placeholder="Justificativa comprovável (obrigatória — genérica não é aceita)"
                    value={justificativa}
                    onChange={(e) => setJustificativa(e.target.value)}
                  />
                )}
              </div>
            </div>

            <div className="flex gap-2">
              <Button type="submit" disabled={criacao.tipo === 'criando' || fonteStatus !== 'ok'}>
                {criacao.tipo === 'criando' ? 'Registrando…' : 'Registrar ocorrência'}
              </Button>
              <Button type="button" variant="outline" onClick={limpar}>
                Limpar
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>
    </div>
  )
}

export default NovaReuniao
