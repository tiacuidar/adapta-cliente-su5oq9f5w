import { useEffect, useMemo, useState } from 'react'
import pb from '@/lib/pocketbase/client'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
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
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog'
import { Alert, AlertDescription } from '@/components/ui/alert'

/* LT-1-T03 — Fila de revisão e aprovação de exceções (SPEC-1-002 + matriz F1-T04)
   Consultor: corrige rascunhos; não vê aguardando_aprovacao_de_excecao (RLS).
   Gestor/Admin: aprova/rejeita exceção com motivo (aprovador ≠ solicitante). */

const ESTADOS = [
  { v: 'todos', label: 'Todos' },
  { v: 'pendente', label: 'Pendente' },
  { v: 'em_revisao', label: 'Em revisão' },
  { v: 'aguardando_correcao', label: 'Aguardando correção' },
  { v: 'aguardando_aprovacao_de_excecao', label: 'Aguardando aprovação de exceção' },
  { v: 'possivel_duplicidade', label: 'Possível duplicidade' },
  { v: 'falha_de_gravacao', label: 'Falha de gravação' },
  { v: 'confirmado', label: 'Confirmado' },
]

const BADGE_VARIANT: Record<string, 'default' | 'secondary' | 'destructive' | 'outline'> = {
  pendente: 'outline',
  em_revisao: 'secondary',
  aguardando_correcao: 'destructive',
  aguardando_aprovacao_de_excecao: 'destructive',
  possivel_duplicidade: 'destructive',
  falha_de_gravacao: 'destructive',
  confirmado: 'default',
}

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
  criado_por: string
  aprovador_por: string
  updated: string
}

const Fila = () => {
  const [itens, setItens] = useState<Ocorrencia[]>([])
  const [carregando, setCarregando] = useState(true)
  const [filtroEstado, setFiltroEstado] = useState('todos')
  const [filtroEmpresa, setFiltroEmpresa] = useState('todas')
  const [selecionada, setSelecionada] = useState<Ocorrencia | null>(null)
  const [motivo, setMotivo] = useState('')
  const [erro, setErro] = useState('')
  const [processando, setProcessando] = useState(false)

  const auth = pb.authStore.record
  const role = String(auth?.role || 'consultor')
  const podeAprovar = role === 'gestor' || role === 'administrador'

  const carregar = async () => {
    setCarregando(true)
    try {
      const filtro = filtroEstado === 'todos' ? '' : `estado = "${filtroEstado}"`
      const res = await pb.collection('ocorrencias').getList(1, 100, {
        filter: filtro,
        sort: '-updated',
      })
      setItens(res.items as unknown as Ocorrencia[])
    } catch {
      setItens([])
    } finally {
      setCarregando(false)
    }
  }

  useEffect(() => {
    carregar()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filtroEstado])

  const filtrados = useMemo(
    () =>
      filtroEmpresa === 'todas'
        ? itens
        : itens.filter((i) => (i.empresa || 'acuidar') === filtroEmpresa),
    [itens, filtroEmpresa],
  )

  const transicionar = async (oc: Ocorrencia, novoEstado: string, motivoTxt: string) => {
    setErro('')
    setProcessando(true)
    try {
      // pb.send prefixa /api — a rota custom existe em /backend/v1/... (sem /api), então
      // usamos fetch direto com o token do authStore (mesma via provada por curl)
      const token = pb.authStore.token
      const res = await fetch('/backend/v1/ocorrencias/transicao', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: token,
        },
        body: JSON.stringify({ id: oc.id, estado: novoEstado, motivo: motivoTxt }),
      })
      if (!res.ok) {
        const errData = await res.json().catch(() => ({}))
        setErro(
          errData.mensagem ||
            (res.status === 404
              ? 'Você não tem permissão para esta ação.'
              : 'Falha de comunicação (' + res.status + ').'),
        )
        return false
      }
      const data = (await res.json()) as { resultado: string; mensagem?: string }
      if (data.resultado !== 'ok') {
        setErro(data.mensagem || 'Transição negada.')
        return false
      }
      setSelecionada(null)
      setMotivo('')
      await carregar()
      return true
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : ''
      setErro(
        msg.includes('404') || msg.includes('não encontrada')
          ? 'Você não tem permissão para esta ação.'
          : 'Falha de comunicação.',
      )
      return false
    } finally {
      setProcessando(false)
    }
  }

  const aprovar = async () => {
    if (!selecionada) return
    if (!motivo.trim()) {
      setErro('Motivo obrigatório para aprovar ou rejeitar uma exceção.')
      return
    }
    await transicionar(selecionada, 'confirmado', 'Exceção APROVADA: ' + motivo.trim())
  }

  const rejeitar = async () => {
    if (!selecionada) return
    if (!motivo.trim()) {
      setErro('Motivo obrigatório para aprovar ou rejeitar uma exceção.')
      return
    }
    await transicionar(selecionada, 'aguardando_correcao', 'Exceção REJEITADA: ' + motivo.trim())
  }

  const corrigir = async (oc: Ocorrencia) => {
    await transicionar(oc, 'em_revisao', 'Correção concluída pelo consultor.')
  }

  return (
    <div className="container mx-auto py-8 px-4 max-w-4xl">
      <h1 className="text-2xl font-bold mb-1">Fila de ocorrências</h1>
      <p className="text-sm text-muted-foreground mb-4">
        Revisão e aprovação — seu perfil: <Badge variant="secondary">{role}</Badge>
        {!podeAprovar && ' (exceções aguardando aprovação não são visíveis ao consultor)'}
      </p>

      <div className="flex flex-wrap gap-3 mb-4">
        <div className="space-y-1">
          <Label className="text-xs">Estado</Label>
          <Select value={filtroEstado} onValueChange={setFiltroEstado}>
            <SelectTrigger className="w-64">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {ESTADOS.map((e) => (
                <SelectItem key={e.v} value={e.v}>
                  {e.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1">
          <Label className="text-xs">Empresa</Label>
          <Select value={filtroEmpresa} onValueChange={setFiltroEmpresa}>
            <SelectTrigger className="w-48">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="todas">Todas</SelectItem>
              <SelectItem value="acuidar">Acuidar</SelectItem>
              <SelectItem value="donahelp">Dona Help</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>

      {erro && (
        <Alert variant="destructive" className="mb-4">
          <AlertDescription>{erro}</AlertDescription>
        </Alert>
      )}

      {carregando ? (
        <p className="text-sm text-muted-foreground">Carregando…</p>
      ) : filtrados.length === 0 ? (
        <Card>
          <CardContent className="py-8 text-center text-sm text-muted-foreground">
            Nenhuma ocorrência neste filtro.
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-2">
          {filtrados.map((oc) => (
            <Card
              key={oc.id}
              className="cursor-pointer hover:bg-muted/40"
              onClick={() => {
                setSelecionada(oc)
                setErro('')
                setMotivo('')
              }}
            >
              <CardContent className="py-3 px-4 flex items-center justify-between gap-3">
                <div className="min-w-0">
                  <p className="font-medium truncate">{oc.titulo}</p>
                  <p className="text-xs text-muted-foreground">
                    {oc.empresa || 'acuidar'} · unidade {oc.portal_unit_id} · {oc.occurrence_type} ·{' '}
                    {oc.data_fato?.slice(0, 10)} {oc.horario}
                  </p>
                </div>
                <Badge variant={BADGE_VARIANT[oc.estado] || 'outline'}>{oc.estado}</Badge>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      <Dialog open={!!selecionada} onOpenChange={(v) => !v && setSelecionada(null)}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>{selecionada?.titulo}</DialogTitle>
            <DialogDescription>
              Estado:{' '}
              <Badge variant={BADGE_VARIANT[selecionada?.estado || ''] || 'outline'}>
                {selecionada?.estado}
              </Badge>
            </DialogDescription>
          </DialogHeader>
          {selecionada && (
            <div className="space-y-3 text-sm">
              <div className="grid grid-cols-2 gap-2 text-xs text-muted-foreground">
                <span>Empresa: {selecionada.empresa || 'acuidar'}</span>
                <span>Unidade: {selecionada.portal_unit_id}</span>
                <span>Data do fato: {selecionada.data_fato?.slice(0, 10)}</span>
                <span>Horário: {selecionada.horario}</span>
                <span>Tipo: {selecionada.occurrence_type}</span>
                <span>Atualizada: {selecionada.updated?.slice(0, 16).replace('T', ' ')}</span>
              </div>
              <div className="rounded-md border p-3 whitespace-pre-wrap text-sm">
                {selecionada.relato || '(sem relato)'}
              </div>
              {selecionada.motivo && (
                <div className="rounded-md bg-muted p-3 text-xs">
                  <p className="font-medium mb-1">Trilha de decisão</p>
                  <p className="whitespace-pre-wrap">{selecionada.motivo}</p>
                </div>
              )}

              {selecionada.estado === 'aguardando_aprovacao_de_excecao' && (
                <div className="space-y-2">
                  <Label>Decisão da exceção (motivo obrigatório)</Label>
                  <Textarea
                    rows={2}
                    placeholder="Ex.: falha técnica comprovada na agenda — aprovado"
                    value={motivo}
                    onChange={(e) => setMotivo(e.target.value)}
                  />
                  <div className="flex gap-2">
                    <Button onClick={aprovar} disabled={processando}>
                      Aprovar exceção
                    </Button>
                    <Button variant="outline" onClick={rejeitar} disabled={processando}>
                      Rejeitar (volta a correção)
                    </Button>
                  </div>
                </div>
              )}

              {selecionada.estado === 'aguardando_correcao' && (
                <Button onClick={() => corrigir(selecionada)} disabled={processando}>
                  Marcar como revisada (correção concluída)
                </Button>
              )}
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  )
}

export default Fila
