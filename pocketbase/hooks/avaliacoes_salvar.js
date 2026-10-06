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
      mensagem: 'Programa inválido. Use pefcab (Acuidar) ou pedhe (Dona Help).',
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

  // 20 perguntas obrigatórias (0/1/2)
  const perguntas = []
  const faltando = []
  for (let i = 1; i <= 20; i++) {
    const v = body['q' + i]
    if (v === undefined || v === null || v === '') {
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
  if (faltando.length > 0) {
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

  // Fórmula confirmada: soma das 20 perguntas + pontuação faturamento + pontuação contratos
  let soma = 0
  for (const p of perguntas) soma += p
  const resultadoGeral = soma + pontFat + pontCont

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
    pontuacao_faturamento: pontFat,
    pontuacao_contratos: pontCont,
    resultado_geral: resultadoGeral,
    ranqueada: ranqueada,
    atualizado: !!existente,
    gravado_por: auth.id,
  })
})
