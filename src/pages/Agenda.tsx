import { useState } from 'react'
import pb from '@/lib/pocketbase/client'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import { PageHeader } from '@/components/PageHeader'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Badge } from '@/components/ui/badge'

/* LT-1-T07 — Importação do Google Agenda (gestor/admin; consultora só a sua empresa)
   Resumo da importação: importadas, já existentes, sem unidade (conferência humana),
   canceladas, erros. Idempotência garante zero duplicatas em reimportação. */

type Resumo = {
  total_eventos: number
  importadas: number
  ja_existentes: number
  sem_unidade: number
  canceladas: number
  remarcadas: number
  erros: number
}

type Resposta =
  | {
      resultado: 'ok'
      empresa: string
      janela: { de: string; ate: string }
      resumo: Resumo
      sem_unidade_lista: { event_id: string; titulo: string; inicio: string }[]
      ids_criadas: string[]
      timestamp: string
    }
  | { resultado: 'credencial_ausente'; secret?: string; mensagem: string }
  | { resultado: 'credencial_expirada'; mensagem: string }
  | { resultado: 'dados_indisponiveis'; motivo: string; fonte?: string }
  | { resultado: 'erro'; mensagem: string }

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
  const [carregando, setCarregando] = useState(false)
  const [resposta, setResposta] = useState<Resposta | null>(null)
  const [erro, setErro] = useState('')

  const importar = async () => {
    setCarregando(true)
    setErro('')
    setResposta(null)
    try {
      // Rota custom POST fora de /api/*: fetch com URL absoluta do backend
      // (pb.send prefixa /api; nginx do preview não repassa POST /backend — AP-1215)
      const res = await fetch(pb.baseUrl + '/backend/v1/agenda/importar', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: pb.authStore.token,
        },
        body: JSON.stringify({ empresa }),
      })
      const data = (await res.json()) as Resposta
      setResposta(data)
    } catch {
      setErro('Falha de comunicação ao importar da agenda.')
    } finally {
      setCarregando(false)
    }
  }

  return (
    <div className="space-y-6 max-w-3xl">
      <PageHeader
        title="📅 Importar da Agenda"
        subtitle="Importa reuniões elegíveis do Google Calendar (janela: 7 dias atrás a 14 dias à frente). Reimportar não cria duplicatas. Reuniões sem unidade identificável vão para conferência humana — o sistema nunca adivinha."
      />

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Executar importação</CardTitle>
          <CardDescription>
            A credencial do Google fica nos Secrets do Skip — nunca no navegador.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Label>Empresa</Label>
            <Select value={empresa} onValueChange={setEmpresa}>
              <SelectTrigger className="w-64">
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

          <Button onClick={importar} disabled={carregando}>
            {carregando ? 'Importando…' : 'Importar da Agenda'}
          </Button>

          {erro && (
            <Alert variant="destructive">
              <AlertDescription>{erro}</AlertDescription>
            </Alert>
          )}

          {resposta?.resultado === 'credencial_ausente' && (
            <Alert variant="destructive">
              <AlertDescription>
                <strong>Credencial ausente{resposta.secret ? ` (${resposta.secret})` : ''}.</strong>{' '}
                {resposta.mensagem}
              </AlertDescription>
            </Alert>
          )}

          {resposta?.resultado === 'credencial_expirada' && (
            <Alert variant="destructive">
              <AlertDescription>
                <strong>Credencial expirada.</strong> {resposta.mensagem}
              </AlertDescription>
            </Alert>
          )}

          {resposta?.resultado === 'dados_indisponiveis' && (
            <Alert variant="destructive">
              <AlertDescription>
                Dados indisponíveis ({resposta.motivo}) — nenhuma importação parcial foi feita.
              </AlertDescription>
            </Alert>
          )}

          {resposta?.resultado === 'erro' && (
            <Alert variant="destructive">
              <AlertDescription>{resposta.mensagem}</AlertDescription>
            </Alert>
          )}

          {resposta?.resultado === 'ok' && (
            <div className="space-y-3">
              <Alert className="border-green-600 bg-green-50">
                <AlertDescription>
                  ✅ Importação concluída — janela {resposta.janela.de} a {resposta.janela.ate}
                </AlertDescription>
              </Alert>
              <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
                <Card>
                  <CardHeader className="pb-1">
                    <CardDescription className="text-xs">Eventos na agenda</CardDescription>
                  </CardHeader>
                  <CardContent>
                    <p className="text-2xl font-bold">{resposta.resumo.total_eventos}</p>
                  </CardContent>
                </Card>
                <Card>
                  <CardHeader className="pb-1">
                    <CardDescription className="text-xs">Importadas</CardDescription>
                  </CardHeader>
                  <CardContent>
                    <p className="text-2xl font-bold text-green-600">
                      {resposta.resumo.importadas}
                    </p>
                  </CardContent>
                </Card>
                <Card>
                  <CardHeader className="pb-1">
                    <CardDescription className="text-xs">Já existentes</CardDescription>
                  </CardHeader>
                  <CardContent>
                    <p className="text-2xl font-bold">{resposta.resumo.ja_existentes}</p>
                  </CardContent>
                </Card>
                <Card>
                  <CardHeader className="pb-1">
                    <CardDescription className="text-xs">Canceladas</CardDescription>
                  </CardHeader>
                  <CardContent>
                    <p className="text-2xl font-bold text-amber-600">
                      {resposta.resumo.canceladas}
                    </p>
                  </CardContent>
                </Card>
                <Card>
                  <CardHeader className="pb-1">
                    <CardDescription className="text-xs">Sem unidade (conferir)</CardDescription>
                  </CardHeader>
                  <CardContent>
                    <p className="text-2xl font-bold text-amber-600">
                      {resposta.resumo.sem_unidade}
                    </p>
                  </CardContent>
                </Card>
                <Card>
                  <CardHeader className="pb-1">
                    <CardDescription className="text-xs">Erros</CardDescription>
                  </CardHeader>
                  <CardContent>
                    <p className="text-2xl font-bold text-red-600">{resposta.resumo.erros}</p>
                  </CardContent>
                </Card>
              </div>
              {resposta.sem_unidade_lista.length > 0 && (
                <Card>
                  <CardHeader>
                    <CardTitle className="text-sm">Reuniões sem unidade identificável</CardTitle>
                    <CardDescription>
                      Conferência humana — o sistema não adivinha a unidade (RN-1-19).
                    </CardDescription>
                  </CardHeader>
                  <CardContent className="space-y-2">
                    {resposta.sem_unidade_lista.map((s) => (
                      <div key={s.event_id} className="rounded-md border p-2 text-sm">
                        <p className="font-medium">{s.titulo}</p>
                        <p className="text-xs text-muted-foreground">
                          {s.inicio.slice(0, 16).replace('T', ' ')} ·{' '}
                          <Badge variant="outline">{s.event_id}</Badge>
                        </p>
                      </div>
                    ))}
                  </CardContent>
                </Card>
              )}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  )
}

export default Agenda
