import { useEffect, useState } from 'react'
import pb from '@/lib/pocketbase/client'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'

/* LT-1-T01 — Home autenticada mínima: saudação + role + sair.
   Fora do escopo desta task: fluxo de registro, ocorrências, painel (tasks seguintes da leva). */

const Index = () => {
  const [nome, setNome] = useState('')
  const [role, setRole] = useState('')

  useEffect(() => {
    const auth = pb.authStore.record
    setNome(String(auth?.name || auth?.email || ''))
    setRole(String(auth?.role || ''))
  }, [])

  const sair = () => {
    pb.authStore.clear()
    window.location.href = '/login'
  }

  return (
    <div className="container mx-auto flex min-h-screen items-center justify-center px-4">
      <Card className="w-full max-w-md text-center">
        <CardHeader>
          <CardTitle className="text-2xl">Bem-vindo, {nome || 'usuário'}</CardTitle>
          <CardDescription>Intranet Adapta Cliente</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {role && (
            <div className="flex items-center justify-center gap-2">
              <span className="text-sm text-muted-foreground">Perfil:</span>
              <Badge variant="secondary">{role}</Badge>
            </div>
          )}
          <Button variant="outline" onClick={sair}>
            Sair
          </Button>
        </CardContent>
      </Card>
    </div>
  )
}

export default Index
