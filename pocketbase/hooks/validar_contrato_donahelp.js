// Ferramenta temporária de validação de contrato (F1-T01 padrão) — NÃO é task da SPEC.
// Propósito: provar o contrato da API da Dona Help sem o token sair do servidor.
// O token é lido do secret DONAHELP_PORTAL_TOKEN via $secrets.get — nunca logado,
// nunca ecoado na resposta. Resposta contém apenas metadados sanitizados.
//
// Segurança:
// - $secrets.get não expõe o valor; a resposta nunca inclui o token ou parte dele.
// - Autenticação: header Authorization com token puro (padrão Acuidar — a confirmar).
// - Amostra sanitizada: apenas nomes de campos + 1 registro com valores mascarados.
// - Remoção: após a validação do contrato, este hook será removido (não fica em produção).

routerAdd(
  'GET',
  '/backend/v1/ferramentas/validar-contrato-donahelp',
  (e) => {
    const token = $secrets.get('DONAHELP_PORTAL_TOKEN') || ''

    // Secret ausente ou provisório → sem tentativa de chamada externa
    if (!token || token === 'PENDENTE_SUBSTITUIR_PELO_TOKEN_REAL') {
      return e.json(200, {
        resultado: 'secret_pendente',
        motivo:
          'DONAHELP_PORTAL_TOKEN ausente ou com valor provisório — gravar o token real no Builder antes de validar.',
      })
    }

    let res
    try {
      res = $http.send({
        url: 'https://app.donahelpbr.com.br/api/dados/unidades',
        method: 'GET',
        headers: { Authorization: token },
        timeout: 20,
      })
    } catch (err) {
      return e.json(200, {
        resultado: 'transporte_falhou',
        detalhe: 'Falha de rede/TLS/timeout ao chamar a API da Dona Help.',
        errorId: $security.randomString(8),
      })
    }

    // Resposta sanitizada — nunca incluir o token ou o corpo cru completo
    const httpStatus = res.statusCode
    let parsed = null
    try {
      parsed = JSON.parse(res.body)
    } catch (err) {
      parsed = null
    }

    if (httpStatus !== 200 || !parsed) {
      // Erro conhecido do padrão: {"status":"error","message":"Erro no Token"}
      return e.json(200, {
        resultado: 'erro_http',
        http_status: httpStatus,
        status_api: parsed && parsed.status ? parsed.status : null,
        message: parsed && parsed.message ? parsed.message : null,
        body_preview: typeof res.body === 'string' ? res.body.slice(0, 200) : null,
      })
    }

    // Sucesso: mapear estrutura sem expor dados sensíveis
    const dados = parsed.dados || parsed.data || parsed.unidades || parsed
    const isArray = Array.isArray(dados)
    const count = isArray ? dados.length : null
    const fields =
      isArray && dados.length > 0
        ? Object.keys(dados[0])
        : parsed && typeof parsed === 'object'
          ? Object.keys(parsed)
          : []

    // Amostra mascarada do primeiro registro: valores → tipo/len, chaves mantidas
    let sampleMasked = null
    if (isArray && dados.length > 0) {
      sampleMasked = {}
      for (const [k, v] of Object.entries(dados[0])) {
        sampleMasked[k] =
          v === null
            ? 'null'
            : typeof v === 'number'
              ? 'number'
              : typeof v === 'string'
                ? 'string(' + v.length + ')'
                : typeof v
      }
    }

    // Unicidade de código (chave oficial da unidade — padrão F1-T01)
    let codesUnique = null
    let codeField = null
    if (isArray && dados.length > 0) {
      const candidates = ['codigo', 'cod', 'unit_code', 'id']
      for (const c of candidates) {
        if (dados[0][c] !== undefined) {
          codeField = c
          break
        }
      }
      if (codeField) {
        const vals = dados.map((u) => String(u[codeField]))
        codesUnique = new Set(vals).size === vals.length
      }
    }

    return e.json(200, {
      resultado: 'ok',
      http_status: httpStatus,
      status_api: parsed.status ?? null,
      message: parsed.message ?? null,
      estrutura: isArray ? 'array' : typeof parsed,
      wrapper_keys: isArray ? Object.keys(parsed) : null,
      total_unidades: count,
      campos: fields,
      campo_codigo: codeField,
      codigos_unicos: codesUnique,
      amostra_mascarada: sampleMasked,
    })
  },
  $apis.requireAuth(),
)
