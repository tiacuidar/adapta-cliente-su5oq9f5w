// LT-1-T02 — Proxy server-side de unidades (Acuidar + Dona Help)
// Os tokens ficam nos Secrets do Skip; o frontend nunca os vê.
// Contratos validados: Acuidar = wrapper {status,message,dados}; Dona Help = array direto.
// RN-1-14: resposta sempre sanitizada com resultado explícito; falha → dados_indisponiveis.

routerAdd(
  'GET',
  '/backend/v1/unidades',
  (e) => {
    const q = e.requestInfo().query
    const empresa = q.empresa || ''

    if (empresa !== 'acuidar' && empresa !== 'donahelp') {
      return e.json(400, { resultado: 'erro', motivo: 'empresa_invalida' })
    }

    const token =
      empresa === 'acuidar'
        ? $secrets.get('ACUIDAR_PORTAL_TOKEN') || ''
        : $secrets.get('DONAHELP_PORTAL_TOKEN') || ''

    if (!token) {
      return e.json(200, {
        resultado: 'dados_indisponiveis',
        motivo: 'credencial_ausente',
      })
    }

    const url =
      empresa === 'acuidar'
        ? 'https://app.acuidarbr.com.br/api/dados/unidades'
        : 'https://app.donahelpbr.com.br/api/dados/unidades'

    let res
    try {
      res = $http.send({
        url: url,
        method: 'GET',
        headers: { Authorization: token },
        timeout: 20,
      })
    } catch (err) {
      return e.json(200, {
        resultado: 'dados_indisponiveis',
        motivo: 'falha_de_conexao',
        errorId: $security.randomString(8),
      })
    }

    if (res.statusCode !== 200) {
      return e.json(200, {
        resultado: 'dados_indisponiveis',
        motivo: 'erro_http_' + res.statusCode,
      })
    }

    // res.body é bytes (AP-2026-09-30-1715) — usar res.json
    let parsed = null
    if (res.json && typeof res.json === 'object') {
      parsed = res.json
    } else if (res.body) {
      try {
        parsed = JSON.parse(new TextDecoder().decode(res.body))
      } catch (err) {
        parsed = null
      }
    }

    if (!parsed) {
      return e.json(200, {
        resultado: 'dados_indisponiveis',
        motivo: 'resposta_invalida',
      })
    }

    // Parser por empresa: wrapper (Acuidar) vs array direto (Dona Help)
    // F1-T01 validou {status, message, dados}; aceitar qualquer wrapper com array em dados
    let lista = null
    if (empresa === 'acuidar') {
      if (Array.isArray(parsed.dados)) {
        lista = parsed.dados
      } else if (Array.isArray(parsed.data)) {
        lista = parsed.data
      } else if (Array.isArray(parsed.unidades)) {
        lista = parsed.unidades
      }
    } else {
      if (Array.isArray(parsed)) {
        lista = parsed
      }
    }

    if (!lista) {
      // Diagnóstico sanitizado: apenas tipos/chaves, nunca valores
      const diag = {
        tipo_raiz: typeof parsed,
        chaves_raiz: parsed && typeof parsed === 'object' ? Object.keys(parsed).slice(0, 10) : null,
        tipo_dados: parsed && typeof parsed === 'object' ? typeof parsed.dados : null,
        dados_e_array: parsed && typeof parsed === 'object' ? Array.isArray(parsed.dados) : null,
      }
      return e.json(200, {
        resultado: 'dados_indisponiveis',
        motivo: 'estrutura_inesperada',
        diagnostico: diag,
      })
    }

    // Sanitizar: apenas os campos que a intranet usa (minimização — LGPD)
    const unidades = lista.map((u) => ({
      codigo: String(u.codigo ?? ''),
      nome: String(u.nome ?? ''),
      razao_social: String(u.razao_social ?? ''),
    }))

    return e.json(200, {
      resultado: 'ok',
      empresa: empresa,
      timestamp: new Date().toISOString(),
      total: unidades.length,
      unidades: unidades,
    })
  },
  $apis.requireAuth(),
)
