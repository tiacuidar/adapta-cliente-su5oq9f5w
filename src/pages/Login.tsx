import { useState } from 'react'
import pb from '@/lib/pocketbase/client'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { ShieldAlert, LogIn } from 'lucide-react'

/* LT-1-T01 — Tela de login da intranet Adapta Cliente (estilo NEXUS FA-5)
   Critérios: login válido autentica; credencial inválida recebe mensagem genérica
   (não revela se a conta existe); sem segredo em log. */

const Login = () => {
  const [email, setEmail] = useState('')
  const [senha, setSenha] = useState('')
  const [erro, setErro] = useState('')
  const [carregando, setCarregando] = useState(false)

  const entrar = async (e: React.FormEvent) => {
    e.preventDefault()
    setErro('')
    setCarregando(true)
    try {
      await pb.collection('users').authWithPassword(email.trim(), senha)
      // LT-2-T02 — sincronização das agendas ao logar (pedido do champion 2026-10-07 12:53,
      // autorizado 12:55): após auth ok, importa as agendas das empresas que o usuário pode ver.
      // FIRE-AND-FORGET: o login NUNCA depende do Google (mesmo princípio da LT-2-T01) —
      // falha de credencial/rede é silenciosa; o botão manual da tela /agenda continua.
      const rec = pb.authStore.record
      const role = String(rec?.role || 'consultor')
      const autorizadas: string[] =
        role === 'gestor' || role === 'administrador'
          ? ['acuidar', 'donahelp']
          : ((rec?.empresas_autorizadas as string[]) || []).filter(
              (e2) => e2 === 'acuidar' || e2 === 'donahelp',
            )
      for (const emp of autorizadas) {
        fetch(pb.baseUrl + '/backend/v1/agenda/importar', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: pb.authStore.token },
          body: JSON.stringify({ empresa: emp }),
        }).catch(() => {
          // silencioso — o login nunca depende do Google
        })
      }
      // Sucesso: o guard de rota em App.tsx renderiza a área autenticada
      window.location.href = '/'
    } catch (err: unknown) {
      // Mensagem genérica para qualquer falha de autenticação (400/404/timeout):
      // não revela se a conta existe ou qual campo está errado.
      setErro('E-mail ou senha inválidos.')
    } finally {
      setCarregando(false)
    }
  }

  return (
    <div className="min-h-screen bg-slate-950 flex flex-col justify-center items-center p-4 relative overflow-hidden">
      <div className="absolute top-0 left-1/2 -translate-x-1/2 w-[800px] h-[400px] bg-emerald-500/10 blur-[120px] rounded-full pointer-events-none" />

      <div className="w-full max-w-md z-10 space-y-6">
        <div className="text-center space-y-3">
          <div className="inline-flex items-center justify-center p-3 bg-slate-900/80 border border-slate-800 rounded-2xl shadow-xl backdrop-blur-sm">
            <div className="h-16 sm:h-20 w-16 sm:w-20 rounded-xl bg-[var(--brand-primary)] flex items-center justify-center text-white font-black text-3xl">
              A
            </div>
          </div>
          <div>
            <h1 className="text-2xl font-bold tracking-tight text-white">ADAPTA CLIENTE</h1>
            <p className="text-sm text-slate-400">Intranet — Acuidar & Dona Help</p>
          </div>
        </div>

        <Card className="bg-slate-900/90 border-slate-800 text-slate-100 shadow-2xl backdrop-blur-sm">
          <CardHeader className="space-y-1 pb-4">
            <CardTitle className="text-xl font-semibold text-white">Acesse sua conta</CardTitle>
            <CardDescription className="text-slate-400">
              Digite suas credenciais de acesso corporativo
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {erro && (
              <Alert variant="destructive" className="bg-red-950/50 border-red-800 text-red-200">
                <ShieldAlert className="h-4 w-4" />
                <AlertDescription className="ml-2 font-medium">{erro}</AlertDescription>
              </Alert>
            )}

            <form onSubmit={entrar} className="space-y-4" noValidate>
              <div className="space-y-1.5">
                <Label htmlFor="email" className="text-slate-300">
                  E-mail corporativo
                </Label>
                <Input
                  id="email"
                  type="email"
                  autoComplete="email"
                  placeholder="usuario@empresa.com.br"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  className="bg-slate-950 border-slate-800 text-white placeholder:text-slate-600 focus:border-emerald-500"
                  required
                />
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="senha" className="text-slate-300">
                  Senha
                </Label>
                <Input
                  id="senha"
                  type="password"
                  autoComplete="current-password"
                  placeholder="••••••••"
                  value={senha}
                  onChange={(e) => setSenha(e.target.value)}
                  className="bg-slate-950 border-slate-800 text-white placeholder:text-slate-600 focus:border-emerald-500"
                  required
                />
              </div>

              <Button
                type="submit"
                disabled={carregando}
                className="w-full bg-emerald-600 hover:bg-emerald-500 text-white font-medium transition-colors py-5"
              >
                {carregando ? (
                  <span className="flex items-center gap-2">
                    <span className="h-4 w-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                    Entrando...
                  </span>
                ) : (
                  <span className="flex items-center gap-2">
                    <LogIn className="h-4 w-4" /> Entrar no Portal
                  </span>
                )}
              </Button>
            </form>
          </CardContent>
        </Card>
      </div>
    </div>
  )
}

export default Login
