import pb from '@/lib/pocketbase/client'

/* LT-1-T02 — Busca de unidades das 2 empresas (Acuidar + Dona Help).
   Contratos validados (F1-T01 e sinal multiempresa):
   - Acuidar: HTTP 200 com wrapper {status, message, dados:[...]}
   - Dona Help: HTTP 200 com array direto [...]
   Token lido server-side via hook proxy — nunca exposto no frontend. */

export type Unidade = {
  codigo: string
  nome: string
  razao_social: string
  empresa: 'acuidar' | 'donahelp'
}

export type ResultadoUnidades =
  | { resultado: 'ok'; unidades: Unidade[]; timestamp: string }
  | { resultado: 'dados_indisponiveis'; motivo: string }

// RN-1-14: fonte indisponível → dados_indisponiveis, nunca lista vazia enganosa
export async function buscarUnidades(empresa: 'acuidar' | 'donahelp'): Promise<ResultadoUnidades> {
  try {
    const res = await pb.send('/backend/v1/unidades', {
      method: 'GET',
      query: { empresa },
    })
    const data = res as {
      resultado: string
      unidades?: unknown[]
      motivo?: string
      timestamp?: string
    }
    if (data.resultado !== 'ok' || !Array.isArray(data.unidades)) {
      return { resultado: 'dados_indisponiveis', motivo: data.motivo || 'resposta_invalida' }
    }
    const unidades: Unidade[] = data.unidades.map((u) => {
      const r = u as Record<string, string>
      return {
        codigo: String(r.codigo ?? ''),
        nome: String(r.nome ?? ''),
        razao_social: String(r.razao_social ?? ''),
        empresa,
      }
    })
    return { resultado: 'ok', unidades, timestamp: data.timestamp || new Date().toISOString() }
  } catch {
    return { resultado: 'dados_indisponiveis', motivo: 'falha_de_conexao' }
  }
}
