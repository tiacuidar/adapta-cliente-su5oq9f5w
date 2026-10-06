// FAROL-1 (FA-2) — Criação/atualização de avaliação PECAF/PEDHE com cálculo automático
// POST /backend/v1/avaliacoes/salvar  body: { programa, portal_unit_id, ano, referencia?,
//   tempo_franquia?, q1..q20, faturamento_bruto?, pontuacao_faturamento, contratos_fixos?,
//   pontuacao_contratos, ranqueada, observacao? }
// Fórmula confirmada pelo champion (2026-10-06): resultado_geral = soma(q1..q20) +
//   pontuacao_faturamento (0-20) + pontuacao_contratos (0-20; PEDHE = 0).
// Regras:
//   - programa ↔ empresa coerentes: pefcab→acuidar · pedhe→donahelp (bloqueia mistura)
//   - RLS por empresa (defesa em profundidade): consultor não salva (só gestor/admin)
//   - Idempotência: UNIQUE (programa, portal_unit_id, ano) — reenvio atualiza o mesmo registro
//   - Validação de obrigatórios: erro explícito, nunca gravação parcial
//   - O sistema calcula o resultado — o payload NÃO pode enviá-lo (fonte única de verdade)
routerAdd('POST', '/backend/v1/avaliacoes/salvar', (e) => {
  const auth = e.auth
  if (!auth || !auth.id) {
    return e.json(401, { resultado: 'erro', mensagem: 'Autenticação obrigatória.' })
  }

  const role = auth.getString('role') || 'consultor'
  if (role !== 'gestor' && role !== 'administrador') {
    return e.json(403, {
      resultado: 'erro',
      mensagem: 'Somente gestor ou administrador preenche a avaliação PECAF/PEDHE.',
    })
  }

  const body = e.requestInfo().body || {}
  const programa = String(body.programa || '')
  const empresa = programa === 'pecaf' ? 'acuidar' : programa === 'pedhe' ? 'donahelp' : ''
  if (!empresa) {
    return e.json(200, {
      resultado: 'erro',
      mensagem: 'Programa inválido. Use pefcaf (Acuidar) ou pedhe (Dona Help).',
    })
  }
  // RLS por empresa — defesa em profundidade
  let autorizadas = []
  try {
    autorizadas = auth.get('empresas_autorizadas') || []
  } catch (err) {
    autorizadas = []
  }
  const veAmbas = role === 'gestor' || role === 'administrador'
  if (!veAmbas && !autorizadas.includes(empresa)) {
    return e.json(403, {
      resultado: 'erro',
      mensagem: 'Você não tem acesso à empresa ' + empresa + '.',
    })
  }

  const portalUnitId = String(body.portal_unit_id || '')
  const ano = Number(body.ano || 0)
  if (!portalUnitId || !ano || ano < 2020) {
    return e.json(200, {
      resultado: 'erro',
      mensagem: 'Unidade e ano são obrigatórios (ano >= 2020).',
    })
  }

  // Cliente oculto (0-20) — decisão do champion (2026-10-06 13:42): campo presente nos PDFs,
  // entra no formulário; nas amostras extraídas foi 20 fixo, mas o campo aceita 0-20.
  // Carga histórica: contagem_qualitativa consolidada substitui soma(q)+cliente_oculto.
  // DECLARADO AQUI (antes do loop de perguntas) — a validação do faltando usa contagemQualitativa.
  let clienteOculto = 0
  if (
    body.cliente_oculto !== undefined &&
    body.cliente_oculto !== null &&
    body.cliente_oculto !== ''
  ) {
    clienteOculto = Number(body.cliente_oculto)
    if (isNaN(clienteOculto) || clienteOculto < 0 || clienteOculto > 20) {
      return e.json(200, {
        resultado: 'erro',
        mensagem: 'cliente_oculto inválido (use 0-20).',
      })
    }
  }
  let contagemQualitativa = null
  if (
    body.contagem_qualitativa !== undefined &&
    body.contagem_qualitativa !== null &&
    body.contagem_qualitativa !== ''
  ) {
    contagemQualitativa = Number(body.contagem_qualitativa)
    if (isNaN(contagemQualitativa) || contagemQualitativa < 0) {
      return e.json(200, {
        resultado: 'erro',
        mensagem: 'contagem_qualitativa inválida (use número >= 0).',
      })
    }
  }

  // 20 perguntas (0/1/2) — PECAF usa as 20; PEDHE usa 18 (q19/q20 = 0 automáticos,
  // pois o formulário PEDHE tem 18 perguntas nos PDFs)
  const perguntas = []
  const faltando = []
  const totalPerguntas = programa === 'pedhe' ? 18 : 20
  for (let i = 1; i <= 20; i++) {
    const v = body['q' + i]
    const ausente = v === undefined || v === null || v === ''
    if (ausente && i > totalPerguntas) {
      perguntas.push(0) // PEDHE: q19/q20 sem pergunta correspondente
      continue
    }
    if (ausente) {
      faltando.push('q' + i)
      perguntas.push(0)
    } else {
      const n = Number(v)
      if (isNaN(n) || n < 0 || n > 2) {
        faltando.push('q' + i + ' (valor inválido: use 0, 1 ou 2)')
        perguntas.push(0)
      } else {
        perguntas.push(n)
      }
    }
  }
  // Carga histórica (decisão champion 2026-10-06 13:42): com contagem_qualitativa presente,
  // as respostas individuais q1..q20 NÃO são exigidas (soma consolidada do PDF).
  if (faltando.length > 0 && contagemQualitativa === null) {
    return e.json(200, {
      resultado: 'erro',
      mensagem: 'Perguntas obrigatórias ausentes/inválidas: ' + faltando.join(', ') + '.',
    })
  }

  const pontFat = Number(body.pontuacao_faturamento)
  const pontCont = Number(body.pontuacao_contratos)
  if (isNaN(pontFat) || pontFat < 0 || pontFat > 20) {
    return e.json(200, {
      resultado: 'erro',
      mensagem: 'pontuacao_faturamento obrigatória (0-20).',
    })
  }
  if (isNaN(pontCont) || pontCont < 0 || pontCont > 20) {
    return e.json(200, {
      resultado: 'erro',
      mensagem: 'pontuacao_contratos obrigatória (0-20; no PEDHE use 0).',
    })
  }
  const ranqueada = String(body.ranqueada || '')
  if (ranqueada !== 'sim' && ranqueada !== 'nao') {
    return e.json(200, {
      resultado: 'erro',
      mensagem: 'ranqueada obrigatória (sim ou nao).',
    })
  }

  // Fórmula (decisão champion 2026-10-06 13:42 — cliente oculto entra no cálculo):
  //   base = contagem_qualitativa (carga histórica, soma consolidada do PDF)
  //          || soma(q1..q20) + cliente_oculto
  //   resultado_geral = base + pontuacao_faturamento + pontuacao_contratos
  let soma = 0
  for (const p of perguntas) soma += p
  const base = contagemQualitativa !== null ? contagemQualitativa : soma + clienteOculto
  const resultadoGeral = base + pontFat + pontCont

  // Idempotência: UNIQUE (programa, portal_unit_id, ano) — reenvio atualiza
  let existente = null
  try {
    existente = $app.findFirstRecordByFilter(
      'avaliacoes',
      'programa = {:p} && portal_unit_id = {:u} && ano = {:a}',
      { p: programa, u: portalUnitId, a: ano },
    )
  } catch (err) {
    existente = null
  }

  const col = $app.findCollectionByNameOrId('avaliacoes')
  const rec = existente || new Record(col)
  rec.set('programa', programa)
  rec.set('empresa', empresa)
  rec.set('portal_unit_id', portalUnitId)
  rec.set('ano', ano)
  rec.set('referencia', String(body.referencia || ''))
  rec.set('tempo_franquia', String(body.tempo_franquia || ''))
  for (let i = 1; i <= 20; i++) {
    rec.set('q' + i, perguntas[i - 1])
  }
  rec.set(
    'faturamento_bruto',
    body.faturamento_bruto === undefined || body.faturamento_bruto === ''
      ? null
      : Number(body.faturamento_bruto),
  )
  rec.set('pontuacao_faturamento', pontFat)
  rec.set(
    'contratos_fixos',
    body.contratos_fixos === undefined || body.contratos_fixos === ''
      ? null
      : Number(body.contratos_fixos),
  )
  rec.set('pontuacao_contratos', pontCont)
  rec.set('cliente_oculto', clienteOculto)
  if (contagemQualitativa !== null) {
    rec.set('contagem_qualitativa', contagemQualitativa)
  }
  rec.set('resultado_geral', resultadoGeral)
  rec.set('ranqueada', ranqueada)
  rec.set('preenchido_por', auth.id)
  rec.set('observacao', String(body.observacao || ''))

  try {
    $app.save(rec)
  } catch (err) {
    const msg = String(err || '')
    if (msg.indexOf('unique') !== -1 || msg.indexOf('UNIQUE') !== -1) {
      return e.json(200, {
        resultado: 'erro',
        mensagem:
          'Já existe avaliação desta unidade neste programa/ano (concorrência). Recarregue e tente novamente.',
      })
    }
    return e.json(200, {
      resultado: 'erro',
      mensagem: 'Falha ao gravar a avaliação. Nada foi confirmado.',
    })
  }

  return e.json(200, {
    resultado: 'ok',
    id: rec.id,
    programa: programa,
    portal_unit_id: portalUnitId,
    ano: ano,
    soma_perguntas: soma,
    cliente_oculto: clienteOculto,
    contagem_qualitativa: contagemQualitativa,
    base_calculo: base,
    pontuacao_faturamento: pontFat,
    pontuacao_contratos: pontCont,
    resultado_geral: resultadoGeral,
    ranqueada: ranqueada,
    atualizado: !!existente,
    gravado_por: auth.id,
  })
})
